"""Generate AI posts for a given date and insert them into the database."""

import argparse
import random
import time
import json
import datetime
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, ollama_generate, extract_json
from random_seed import POST_FORMATS, EMOTIONAL_REGISTERS, POST_ANGLES

PROMPT_TEMPLATE = """You are {display_name}, a {age}-year-old {occupation} from {location}.
Your personality: {personality}. You write online like this: {communication_style}.
Your interests include: {interests}.

Write {post_format} in r/{community_name} (topic: {community_topic}).
Emotional register: {emotional_register}.
Write it {post_angle}.

Do not write a generic discussion post. The format and tone above are mandatory.
{recent_section}
Respond with ONLY a JSON object with these exact fields:
- title (string, max 300 chars, the post title)
- body (string, the post body — 1-4 paragraphs OR empty string "" for title-only posts; about 30% should be title-only)
- flair (string or null, a relevant flair tag like "Discussion", "News", "Question", "Rant", etc.)

No other text. Just the JSON object."""


def random_score() -> tuple[int, int, int]:
    """Returns (score, upvote_count, downvote_count) using Pareto distribution."""
    base = random.paretovariate(1.5)
    score = int(base * 3)
    if random.random() < 0.05:
        score = random.randint(500, 5000)
    score = min(score, 10000)
    # Realistic up/down counts
    ratio = random.uniform(0.85, 0.99)
    upvotes = max(score, int(score / ratio)) if score > 0 else random.randint(0, 5)
    downvotes = max(0, upvotes - score)
    return score, upvotes, downvotes


def random_scheduled_at(date: datetime.date) -> int:
    """Return a Unix timestamp within the given date, weighted toward daytime hours."""
    # Hours 9-22 get 3x weight, hour 23 gets 2x, hours 0-8 get 1x
    weights = [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2]
    hour = random.choices(range(24), weights=weights)[0]
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    dt = datetime.datetime(date.year, date.month, date.day, hour, minute, second)
    return int(dt.timestamp())


def weighted_distribution(communities: list, count: int) -> list[dict]:
    """Distribute count posts across communities weighted by member_count."""
    if not communities:
        return []
    total = sum(c["member_count"] for c in communities)
    weights = [c["member_count"] / total for c in communities]
    alloc: dict[int, int] = {}
    for _ in range(count):
        idx = random.choices(range(len(communities)), weights=weights)[0]
        alloc[idx] = alloc.get(idx, 0) + 1
    return [{"community": communities[i], "count": n} for i, n in alloc.items()]


_recent_titles_cache: dict[str, list[str]] = {}


def fetch_recent_post_titles(community_name: str, limit: int = 10) -> list[str]:
    if community_name in _recent_titles_cache:
        return _recent_titles_cache[community_name]
    try:
        resp = req.get(
            f"{APP_API_URL}/communities/{community_name}/posts",
            params={"sort": "new", "limit": limit},
            timeout=10,
        )
        if resp.ok:
            titles = [p["title"] for p in resp.json().get("items", [])]
            _recent_titles_cache[community_name] = titles
            return titles
    except Exception:
        pass
    return []


def fetch_random_user() -> dict | None:
    resp = req.get(
        f"{APP_API_URL}/internal/users/random",
        params={"count": 1},
        headers=INTERNAL_HEADERS,
        timeout=10,
    )
    if resp.ok:
        users = resp.json()
        return users[0] if users else None
    return None


def main():
    parser = argparse.ArgumentParser(description="Generate AI posts for a given date")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--count", type=int, default=50, help="Number of posts to generate")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    args = parser.parse_args()

    target_date = (
        datetime.date.today()
        if args.date == "today"
        else datetime.date.fromisoformat(args.date)
    )
    print(f"Generating {args.count} posts for {target_date}")

    # Fetch communities
    params = {}
    if args.community:
        params["search"] = args.community
    resp = req.get(f"{APP_API_URL}/communities", params=params, timeout=10)
    if not resp.ok:
        print(f"Failed to fetch communities: {resp.status_code}")
        return

    communities = resp.json()
    if args.community:
        communities = [c for c in communities if c["name"] == args.community]
    if not communities:
        print("No communities found. Run generate_communities.py first.")
        return

    distribution = weighted_distribution(communities, args.count)
    all_posts = []
    now = int(time.time())
    generated = 0
    failed = 0

    for item in distribution:
        community = item["community"]
        for _ in range(item["count"]):
            user = fetch_random_user()
            if not user:
                print(f"  No users found for r/{community['name']}, skipping")
                failed += 1
                continue

            personality = json.loads(user.get("personality") or "[]")
            interests = json.loads(user.get("interests") or "[]")

            fmt = random.choice(POST_FORMATS)
            tone = random.choice(EMOTIONAL_REGISTERS)
            angle = random.choice(POST_ANGLES)
            recent = fetch_recent_post_titles(community["name"])
            recent_section = (
                f"Do not write about any of these recently posted topics: {recent}\n"
                if recent else ""
            )

            prompt = PROMPT_TEMPLATE.format(
                display_name=user["display_name"],
                age=user.get("age") or "unknown",
                occupation=user.get("occupation") or "professional",
                location=user.get("location") or "somewhere",
                personality=", ".join(personality) if personality else "curious",
                communication_style=user.get("communication_style") or "normal",
                interests=", ".join(interests) if interests else "various topics",
                community_name=community["name"],
                community_topic=community.get("description") or community["name"],
                post_format=fmt,
                emotional_register=tone,
                post_angle=angle,
                recent_section=recent_section,
            )

            raw = ollama_generate(prompt)
            data = extract_json(raw)

            if not data or "title" not in data:
                print(f"  FAILED post for r/{community['name']}")
                failed += 1
                continue

            score, upvotes, downvotes = random_score()
            all_posts.append({
                "community_name": community["name"],
                "username": user["username"],
                "title": str(data["title"])[:300],
                "body": str(data.get("body") or ""),
                "post_type": "text",
                "score": score,
                "upvote_count": upvotes,
                "downvote_count": downvotes,
                "flair": data.get("flair"),
                "scheduled_at": random_scheduled_at(target_date),
                "created_at": now,
                "updated_at": now,
            })
            generated += 1
            title_preview = str(data["title"])[:60]
            print(f"  [{community['name']}] {title_preview}")

    if not all_posts:
        print("No posts generated.")
        return

    print(f"\nInserting {len(all_posts)} posts...", end=" ", flush=True)
    resp = req.post(
        f"{APP_API_URL}/internal/posts/bulk",
        json={"posts": all_posts},
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        result = resp.json()
        print(f"ok ({result.get('inserted', '?')} inserted)")
    else:
        print(f"FAILED: {resp.status_code} {resp.text}")

    print(f"\nSummary: {generated} generated, {failed} failed, date={target_date}")


if __name__ == "__main__":
    main()
