"""Generate AI comment threads for posts and insert them into the database."""

import argparse
import random
import time
import json
import datetime
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, ollama_generate, extract_json, load_settings

TOP_LEVEL_PROMPT = """You are {display_name}, a {age}-year-old {occupation} from {location}.
Personality: {personality}. You write online like this: {communication_style}.

You are commenting on this post in r/{community_name}:

TITLE: {post_title}
BODY: {post_body}

Write a single Reddit-style comment responding to this post. Your comment should reflect
your personality and communication style. It can be: an opinion, a question, a personal
anecdote, a correction, humor, or agreement/disagreement. Length: 1-4 sentences typically,
occasionally longer.

Respond with ONLY the comment text. No JSON, no quotes, no preamble."""

REPLY_PROMPT = """You are {display_name}, a {age}-year-old {occupation} from {location}.
Personality: {personality}. You write online like this: {communication_style}.
{relationship_section}
You are replying in a thread about "{post_title}":
{thread_context}
REPLY TO (by {parent_author}): {parent_body}

Write a single reply. It could agree, disagree, ask a follow-up, add information, or be
humorous. Stay in character. 1-3 sentences.

Respond with ONLY the reply text."""


def comment_count_for_post(score: int, multiplier: float = 1.0) -> int:
    if score < 5:
        base = random.randint(0, 2)
    elif score < 50:
        base = random.randint(2, 15)
    elif score < 500:
        base = random.randint(10, 60)
    else:
        base = random.randint(30, 200)
    return max(0, round(base * multiplier))


def random_comment_score() -> tuple[int, int, int]:
    """Returns (score, upvote_count, downvote_count) with lower ceiling than posts."""
    base = random.paretovariate(1.5)
    score = int(base * 2)
    score = min(score, 500)
    ratio = random.uniform(0.80, 0.98)
    upvotes = max(score, int(score / ratio)) if score > 0 else random.randint(0, 3)
    downvotes = max(0, upvotes - score)
    return score, upvotes, downvotes


def decay_offset_seconds(post_scheduled_at: int, index: int) -> int:
    """Return a seconds offset from post time, decaying over ~24h. Earlier = more comments."""
    # Most comments in first 2h, tapering over 24h
    max_seconds = 86400  # 24 hours
    weight = random.expovariate(1.5)  # exponential decay — values cluster near 0
    offset = int(weight * max_seconds / 4)
    offset = min(offset, max_seconds) + index * random.randint(30, 300)
    return offset


def fetch_posts(date: datetime.date | None, post_id: int | None, community: str | None) -> list:
    params: dict = {"limit": 200}
    if date:
        params["date"] = date.isoformat()
    resp = req.get(
        f"{APP_API_URL}/internal/posts/recent",
        params=params,
        headers=INTERNAL_HEADERS,
        timeout=10,
    )
    if not resp.ok:
        print(f"Failed to fetch posts: {resp.status_code}")
        return []
    posts = resp.json()
    if post_id:
        posts = [p for p in posts if p["id"] == post_id]
    if community:
        posts = [p for p in posts if p.get("community_name") == community]
    return posts


def fetch_relationships(user_id: int) -> list:
    """Fetch relationships for a user (both directions)."""
    try:
        resp = req.get(
            f"{APP_API_URL}/internal/relationships",
            params={"user_id": user_id},
            headers=INTERNAL_HEADERS,
            timeout=10,
        )
        if resp.ok:
            return resp.json()
    except Exception:
        pass
    return []


def fetch_random_users(count: int = 10) -> list:
    resp = req.get(
        f"{APP_API_URL}/internal/users/random",
        params={"count": count},
        headers=INTERNAL_HEADERS,
        timeout=10,
    )
    if resp.ok:
        return resp.json()
    return []


def flush_comments(batch: list) -> int:
    if not batch:
        return 0
    resp = req.post(
        f"{APP_API_URL}/internal/comments/bulk",
        json={"comments": batch},
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        inserted = resp.json().get("inserted", 0)
        print(f"  Inserted batch of {inserted} comments")
        return inserted
    else:
        print(f"  FAILED comment batch: {resp.status_code} {resp.text}")
        return 0


def generate_comment_tree(
    post: dict,
    users: list,
    max_top_level: int,
    max_depth: int,
    max_replies: int,
    multiplier: float,
    ollama_model: str | None,
    ollama_temp: float,
    use_relationships: bool = True,
) -> list:
    """Generate a flat list of comment dicts for a single post."""
    total = comment_count_for_post(post.get("score", 0), multiplier)
    if total == 0:
        return []

    comments = []
    now = int(time.time())
    post_scheduled = post.get("scheduled_at", now)
    community_name = post.get("community_name", "community")

    used_user_ids: set[int] = {post.get("user_id", -1)}
    comment_index = 0
    temp_id_counter = 0

    # Cache relationships keyed by user_id
    _relationship_cache: dict[int, list] = {}

    def get_relationships(user_id: int) -> list:
        if user_id not in _relationship_cache:
            _relationship_cache[user_id] = fetch_relationships(user_id) if use_relationships else []
        return _relationship_cache[user_id]

    def find_relationship(user_id_a: int, user_id_b: int) -> dict | None:
        for r in get_relationships(user_id_a):
            if r["user_id_a"] == user_id_b or r["user_id_b"] == user_id_b:
                return r
        return None

    def pick_user(exclude: set, prefer_related_to: int | None = None) -> dict | None:
        candidates = [u for u in users if u["id"] not in exclude]
        if not candidates:
            candidates = users
        if not candidates:
            return None

        if prefer_related_to is not None and use_relationships:
            rels = get_relationships(prefer_related_to)
            related_ids = {
                r["user_id_b"] if r["user_id_a"] == prefer_related_to else r["user_id_a"]
                for r in rels
            }
            related_candidates = [u for u in candidates if u["id"] in related_ids]
            if related_candidates and random.random() < 0.4:
                return random.choice(related_candidates)

        return random.choice(candidates) if candidates else None

    def make_comment(user: dict, body: str, parent_temp_id: int | None, depth: int) -> dict:
        nonlocal comment_index, temp_id_counter
        score, upvotes, downvotes = random_comment_score()
        # Bonus for early comments
        if comment_index < 3:
            score = min(score + random.randint(5, 30), 500)
            upvotes = max(upvotes, score)
        offset = decay_offset_seconds(post_scheduled, comment_index)
        comment_index += 1
        temp_id_counter += 1
        return {
            "post_id": post["id"],
            "temp_id": temp_id_counter,
            "parent_id": parent_temp_id,
            "username": user["username"],
            "body": body,
            "score": score,
            "upvote_count": upvotes,
            "downvote_count": downvotes,
            "depth": depth,
            "scheduled_at": post_scheduled + offset,
            "created_at": now,
            "updated_at": now,
        }

    # Generate top-level comments
    top_level_count = min(total, max_top_level)
    top_level_comments: list[dict] = []
    _comment_by_temp_id: dict[int, dict] = {}

    for i in range(top_level_count):
        user = pick_user(used_user_ids if i < len(users) else set())
        if not user:
            break

        personality = json.loads(user.get("personality") or "[]")
        body_text = ollama_generate(
            TOP_LEVEL_PROMPT.format(
                display_name=user["display_name"],
                age=user.get("age") or "30",
                occupation=user.get("occupation") or "professional",
                location=user.get("location") or "somewhere",
                personality=", ".join(personality) if personality else "curious",
                communication_style=user.get("communication_style") or "casual",
                community_name=community_name,
                post_title=post.get("title", ""),
                post_body=(post.get("body") or "")[:500],
            ),
            model=ollama_model,
            temperature=ollama_temp,
        )
        if not body_text or len(body_text.strip()) < 5:
            continue

        c = make_comment(user, body_text.strip()[:2000], None, 0)
        c["_user"] = user  # temp field for reply generation
        if c.get("temp_id"):
            _comment_by_temp_id[c["temp_id"]] = c
        top_level_comments.append(c)
        used_user_ids.add(user["id"])
        print(f"    [{community_name}] top-level comment {i+1}/{top_level_count}")

    # Thread context: track ancestors for deep replies
    def get_thread_context(parent: dict, max_ancestors: int = 3) -> str:
        """Build a short thread context string from ancestors."""
        chain = []
        current = parent
        for _ in range(max_ancestors):
            author = current.get("_user", {}).get("display_name", "someone")
            body = current.get("body", "")[:150]
            chain.append(f"  {author}: {body}")
            pid = current.get("parent_id")
            if pid is None or pid not in _comment_by_temp_id:
                break
            current = _comment_by_temp_id[pid]
        if not chain:
            return ""
        chain.reverse()
        return "\nThread context:\n" + "\n".join(chain) + "\n"

    # Generate replies
    def gen_replies(parent: dict, depth: int, remaining_budget: int) -> int:
        if depth >= max_depth or remaining_budget <= 0:
            return 0
        reply_count = min(random.randint(0, max_replies), remaining_budget)
        spent = 0
        for _ in range(reply_count):
            parent_user = parent.get("_user", {})
            parent_user_id = parent_user.get("id", -1)
            reply_user = pick_user({parent_user_id}, prefer_related_to=parent_user_id)
            if not reply_user:
                break

            # Relationship context
            relationship_section = ""
            if use_relationships:
                rel = find_relationship(reply_user["id"], parent_user_id)
                if rel:
                    rel_type = rel.get("relationship_type", "acquaintance")
                    notes = rel.get("notes") or ""
                    relationship_section = f"\n[Relationship: You and {parent_user.get('display_name', 'this user')} are {rel_type}. {notes}]\n"

            # Thread context for deeper replies
            thread_context = ""
            if depth >= 2:
                thread_context = get_thread_context(parent)

            personality = json.loads(reply_user.get("personality") or "[]")
            body_text = ollama_generate(
                REPLY_PROMPT.format(
                    display_name=reply_user["display_name"],
                    age=reply_user.get("age") or "30",
                    occupation=reply_user.get("occupation") or "professional",
                    location=reply_user.get("location") or "somewhere",
                    personality=", ".join(personality) if personality else "curious",
                    communication_style=reply_user.get("communication_style") or "casual",
                    relationship_section=relationship_section,
                    post_title=post.get("title", ""),
                    thread_context=thread_context,
                    parent_author=parent_user.get("display_name", "someone"),
                    parent_body=parent["body"][:300],
                ),
                model=ollama_model,
                temperature=ollama_temp,
            )
            if not body_text or len(body_text.strip()) < 3:
                continue

            reply = make_comment(reply_user, body_text.strip()[:1000], parent.get("temp_id"), depth)
            reply["_user"] = reply_user
            if reply.get("temp_id"):
                _comment_by_temp_id[reply["temp_id"]] = reply
            comments.append(reply)
            spent += 1
            spent += gen_replies(reply, depth + 1, remaining_budget - spent - 1)
        return spent

    for c in top_level_comments:
        comments.append(c)

    budget = max(0, total - top_level_count)
    for c in top_level_comments:
        if budget <= 0:
            break
        spent = gen_replies(c, 1, budget)
        budget -= spent

    for c in comments:
        c.pop("_user", None)

    return comments


def main():
    parser = argparse.ArgumentParser(description="Generate AI comments for posts")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--post-id", type=int, default=None, help="Only generate for this post ID")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    parser.add_argument("--max-top-level", type=int, default=None)
    parser.add_argument("--max-depth", type=int, default=None)
    parser.add_argument("--max-replies", type=int, default=None)
    args = parser.parse_args()

    settings = load_settings()
    ollama_model = settings.get("ollama_model") or None
    ollama_temp = float(settings.get("ollama_temperature", 0.8))
    max_top_level = args.max_top_level or int(settings.get("max_top_level_comments", 12))
    max_depth = args.max_depth or int(settings.get("max_comment_depth", 4))
    max_replies = args.max_replies or int(settings.get("max_replies_per_comment", 3))
    multiplier = float(settings.get("comments_per_post_multiplier", 1.0))
    use_relationships = settings.get("relationships_enabled", "true").lower() == "true"

    target_date = None
    if not args.post_id:
        target_date = (
            datetime.date.today()
            if args.date == "today"
            else datetime.date.fromisoformat(args.date)
        )

    print(f"Fetching posts...")
    posts = fetch_posts(target_date, args.post_id, args.community)
    if not posts:
        print("No posts found.")
        return

    print(f"Found {len(posts)} posts. Fetching users...")
    users = fetch_random_users(50)
    if not users:
        print("No users found. Run generate_users.py first.")
        return

    total_inserted = 0

    for i, post in enumerate(posts):
        print(f"\n[{i+1}/{len(posts)}] Post {post['id']}: {post.get('title', '')[:60]}")
        comments = generate_comment_tree(
            post, users, max_top_level, max_depth, max_replies, multiplier, ollama_model, ollama_temp,
            use_relationships=use_relationships,
        )
        print(f"  Generated {len(comments)} comments")
        total_inserted += flush_comments(comments)
    print(f"\nDone. Total inserted: {total_inserted}")


if __name__ == "__main__":
    main()
