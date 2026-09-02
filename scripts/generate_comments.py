"""Generate AI comment threads for posts and insert them into the database."""

import argparse
import random
import time
import json
import datetime
import threading
from concurrent.futures import ThreadPoolExecutor
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, llm_generate, extract_json, load_settings, CURRENT_MODEL

TOP_LEVEL_PROMPT = """You are {display_name}, a {age}-year-old {occupation} from {location}.
Personality: {personality}. You write online like this: {writing_style}.

You are commenting on this post in r/{community_name}:

TITLE: {post_title}
BODY: {post_body}

Write a single Reddit-style comment responding to this post. Your comment should reflect
your personality and communication style. It can be: an opinion, a question, a personal
anecdote, a correction, humor, or agreement/disagreement. Length: 1-4 sentences typically,
occasionally longer.

Respond with ONLY the comment text. No JSON, no quotes, no preamble."""

REPLY_PROMPT = """You are {display_name}, a {age}-year-old {occupation} from {location}.
Personality: {personality}. You write online like this: {writing_style}.
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


class CommentJob:
    """All state for generating one post's comment tree, shared across worker threads.

    Work splits into tasks: top-level comments first (independent of each other),
    then reply trees (each reply depends on its parent's text). A single shared
    pool runs tasks from all posts, so no post monopolizes a worker and posts
    finish in roughly the order they were submitted.
    """

    def __init__(self, post: dict, users: list, max_top_level: int, max_depth: int,
                 max_replies: int, multiplier: float, llm_temp: float,
                 use_relationships: bool = True):
        self.post = post
        self.users = users
        self.max_depth = max_depth
        self.max_replies = max_replies
        self.llm_temp = llm_temp
        self.use_relationships = use_relationships
        self.community_name = post.get("community_name", "community")
        self.now = int(time.time())
        self.post_scheduled = post.get("scheduled_at", self.now)
        self.total = comment_count_for_post(post.get("score", 0), multiplier)
        self.top_level_count = min(self.total, max_top_level)

        self.lock = threading.Lock()
        self.outstanding = 0
        self.comment_index = 0
        self.temp_id_counter = 0
        self.top_done = 0
        self.reply_budget = 0
        self.comments: list = []
        self.top_level_comments: list = []
        self.used_user_ids: set = {post.get("user_id", -1)}
        self._comment_by_temp_id: dict = {}
        self._relationship_cache: dict = {}

    def make_comment(self, user: dict, body: str, parent_temp_id: int | None, depth: int) -> dict:
        with self.lock:
            score, upvotes, downvotes = random_comment_score()
            # Bonus for early comments
            if self.comment_index < 3:
                score = min(score + random.randint(5, 30), 500)
                upvotes = max(upvotes, score)
            offset = decay_offset_seconds(self.post_scheduled, self.comment_index)
            self.comment_index += 1
            self.temp_id_counter += 1
            comment = {
                "post_id": self.post["id"],
                "temp_id": self.temp_id_counter,
                "parent_id": parent_temp_id,
                "username": user["username"],
                "body": body,
                "score": score,
                "upvote_count": upvotes,
                "downvote_count": downvotes,
                "depth": depth,
                "model": CURRENT_MODEL,
                "scheduled_at": self.post_scheduled + offset,
                "created_at": self.now,
                "updated_at": self.now,
            }
            self.comments.append(comment)
            self._comment_by_temp_id[comment["temp_id"]] = comment
        return comment

    def claim_budget(self, want: int) -> int:
        with self.lock:
            n = min(want, self.reply_budget)
            self.reply_budget -= n
            return n

    def finish(self) -> list:
        for c in self.comments:
            c.pop("_user", None)
        return self.comments

    def get_relationships(self, user_id: int) -> list:
        if user_id not in self._relationship_cache:
            self._relationship_cache[user_id] = fetch_relationships(user_id) if self.use_relationships else []
        return self._relationship_cache[user_id]

    def find_relationship(self, user_id_a: int, user_id_b: int) -> dict | None:
        for r in self.get_relationships(user_id_a):
            if r["user_id_a"] == user_id_b or r["user_id_b"] == user_id_b:
                return r
        return None

    def pick_user(self, exclude: set, prefer_related_to: int | None = None) -> dict | None:
        candidates = [u for u in self.users if u["id"] not in exclude]
        if not candidates:
            candidates = self.users
        if not candidates:
            return None

        if prefer_related_to is not None and self.use_relationships:
            rels = self.get_relationships(prefer_related_to)
            related_ids = {
                r["user_id_b"] if r["user_id_a"] == prefer_related_to else r["user_id_a"]
                for r in rels
            }
            related_candidates = [u for u in candidates if u["id"] in related_ids]
            if related_candidates and random.random() < 0.4:
                return random.choice(related_candidates)

        return random.choice(candidates) if candidates else None

    def get_thread_context(self, parent: dict, max_ancestors: int = 3) -> str:
        """Build a short thread context string from ancestors."""
        chain = []
        current = parent
        for _ in range(max_ancestors):
            author = current.get("_user", {}).get("display_name", "someone")
            body = current.get("body", "")[:150]
            chain.append(f"  {author}: {body}")
            pid = current.get("parent_id")
            if pid is None or pid not in self._comment_by_temp_id:
                break
            current = self._comment_by_temp_id[pid]
        if not chain:
            return ""
        chain.reverse()
        return "\nThread context:\n" + "\n".join(chain) + "\n"

    # ── tasks: each returns a list of follow-up tasks ─────────────────────

    def top_level_task(self, i: int):
        def task():
            user = self.pick_user(self.used_user_ids if i < len(self.users) else set())
            if not user:
                return self._top_done()

            personality = json.loads(user.get("personality") or "[]")
            body_text = llm_generate(
                TOP_LEVEL_PROMPT.format(
                    display_name=user["display_name"],
                    age=user.get("age") or "30",
                    occupation=user.get("occupation") or "professional",
                    location=user.get("location") or "somewhere",
                    personality=", ".join(personality) if personality else "curious",
                    writing_style=user.get("writing_style") or "casual",
                    community_name=self.community_name,
                    post_title=self.post.get("title", ""),
                    post_body=(self.post.get("body") or "")[:500],
                ),
                temperature=self.llm_temp,
            )
            if not body_text or len(body_text.strip()) < 5:
                return self._top_done()

            c = self.make_comment(user, body_text.strip()[:2000], None, 0)
            c["_user"] = user  # temp field for reply generation
            with self.lock:
                self.top_level_comments.append(c)
                self.used_user_ids.add(user["id"])
                n = len(self.top_level_comments)
            print(f"    [{self.community_name}] top-level comment {n}/{self.top_level_count}")
            return self._top_done()
        return task

    def _top_done(self) -> list:
        """Count a finished top-level; the last one releases the reply budget."""
        with self.lock:
            self.top_done += 1
            last = self.top_done >= self.top_level_count
        if not last:
            return []
        with self.lock:
            self.reply_budget = max(0, self.total - len(self.top_level_comments))
            tops = list(self.top_level_comments)
        return [self.children_task(c, 1) for c in tops]

    def children_task(self, parent: dict, depth: int):
        def task():
            if depth >= self.max_depth:
                return []
            granted = self.claim_budget(random.randint(0, self.max_replies))
            if granted <= 0:
                return []

            parent_user = parent.get("_user", {})
            parent_user_id = parent_user.get("id", -1)
            new_tasks = []
            for _ in range(granted):
                reply_user = self.pick_user({parent_user_id}, prefer_related_to=parent_user_id)
                if not reply_user:
                    break

                # Relationship context
                relationship_section = ""
                if self.use_relationships:
                    rel = self.find_relationship(reply_user["id"], parent_user_id)
                    if rel:
                        rel_type = rel.get("relationship_type", "acquaintance")
                        notes = rel.get("notes") or ""
                        relationship_section = f"\n[Relationship: You and {parent_user.get('display_name', 'this user')} are {rel_type}. {notes}]\n"

                # Thread context for deeper replies
                thread_context = self.get_thread_context(parent) if depth >= 2 else ""

                personality = json.loads(reply_user.get("personality") or "[]")
                body_text = llm_generate(
                    REPLY_PROMPT.format(
                        display_name=reply_user["display_name"],
                        age=reply_user.get("age") or "30",
                        occupation=reply_user.get("occupation") or "professional",
                        location=reply_user.get("location") or "somewhere",
                        personality=", ".join(personality) if personality else "curious",
                        writing_style=reply_user.get("writing_style") or "casual",
                        relationship_section=relationship_section,
                        post_title=self.post.get("title", ""),
                        thread_context=thread_context,
                        parent_author=parent_user.get("display_name", "someone"),
                        parent_body=parent["body"][:300],
                    ),
                    temperature=self.llm_temp,
                )
                if not body_text or len(body_text.strip()) < 3:
                    continue

                reply = self.make_comment(reply_user, body_text.strip()[:1000], parent.get("temp_id"), depth)
                reply["_user"] = reply_user
                new_tasks.append(self.children_task(reply, depth + 1))
            return new_tasks
        return task


def main():
    parser = argparse.ArgumentParser(description="Generate AI comments for posts")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--post-id", type=int, default=None, help="Only generate for this post ID")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    parser.add_argument("--max-top-level", type=int, default=None)
    parser.add_argument("--max-depth", type=int, default=None)
    parser.add_argument("--max-replies", type=int, default=None)
    parser.add_argument("--parallel", type=int, default=1,
                        help="Number of posts to generate comments for concurrently (default: 1)")
    args = parser.parse_args()
    args.parallel = max(1, args.parallel)

    settings = load_settings()
    llm_temp = float(settings.get("llm_temperature", 0.8))
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
    inserted_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        pending = []
        for post in posts:
            job = CommentJob(post, users, max_top_level, max_depth, max_replies,
                             multiplier, llm_temp, use_relationships=use_relationships)
            if job.total == 0:
                print(f"Post {post['id']}: {post.get('title', '')[:60]} — 0 comments")
                continue

            done = threading.Event()

            def make_wrap(post=post, job=job, done=done):
                def wrap(task):
                    def run():
                        nonlocal total_inserted
                        try:
                            children = task()
                        except Exception as e:
                            children = []
                            print(f"  Post {post['id']} error: {e}")
                        with job.lock:
                            for child in children:
                                job.outstanding += 1
                                pool.submit(wrap(child))
                            job.outstanding -= 1
                            finished = job.outstanding == 0
                        if finished:
                            comments = job.finish()
                            with inserted_lock:
                                total_inserted += flush_comments(comments)
                            print(f"Post {post['id']}: {post.get('title', '')[:60]} — {len(comments)} comments")
                            done.set()
                    return run
                return wrap

            wrap = make_wrap()
            for i in range(job.top_level_count):
                with job.lock:
                    job.outstanding += 1
                pool.submit(wrap(job.top_level_task(i)))
            pending.append((post, done))

        for post, done in pending:
            if not done.wait(timeout=3600):
                print(f"  Post {post['id']}: timed out waiting for comment tasks")
    print(f"\nDone. Total inserted: {total_inserted}")


if __name__ == "__main__":
    main()
