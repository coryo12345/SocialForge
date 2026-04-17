"""Analyze user posts and comments to extract behavioral memory summaries."""

import argparse
import json
import time
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, ollama_generate, extract_json, load_settings

MEMORY_PROMPT = """Analyze this user's recent online activity and extract a behavioral memory summary.

Username: {username}

Recent posts:
{posts_text}

Recent comments:
{comments_text}

Extract a structured memory. Focus only on what is clearly demonstrated in the content above.

Respond with ONLY valid JSON (no markdown):
{{
  "opinions": [{{"key": "topic_slug", "value": "their opinion in one sentence"}}],
  "topics": [{{"key": "topic_name", "value": "how they engage with this topic"}}],
  "community_familiarity": [{{"key": "community_name", "value": "their familiarity level and expertise"}}]
}}

Provide 2-4 items per category. Use simple lowercase topic slugs (e.g. "climate_change", "python_programming")."""


def fetch_all_users() -> list:
    resp = req.get(
        f"{APP_API_URL}/internal/users/all",
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        return resp.json()
    return []


def fetch_user_posts(user_id: int, limit: int = 20) -> list:
    resp = req.get(
        f"{APP_API_URL}/internal/users/{user_id}/posts",
        params={"limit": limit},
        headers=INTERNAL_HEADERS,
        timeout=15,
    )
    if resp.ok:
        return resp.json()
    return []


def fetch_user_comments(user_id: int, limit: int = 20) -> list:
    resp = req.get(
        f"{APP_API_URL}/internal/users/{user_id}/comments",
        params={"limit": limit},
        headers=INTERNAL_HEADERS,
        timeout=15,
    )
    if resp.ok:
        return resp.json()
    return []


def fetch_existing_memory(user_id: int) -> list:
    resp = req.get(
        f"{APP_API_URL}/internal/memory",
        params={"user_id": user_id},
        headers=INTERNAL_HEADERS,
        timeout=10,
    )
    if resp.ok:
        return resp.json()
    return []


def flush_memory(memories: list) -> int:
    if not memories:
        return 0
    resp = req.post(
        f"{APP_API_URL}/internal/memory/bulk",
        json={"memories": memories},
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        return resp.json().get("upserted", 0)
    print(f"  FAILED memory flush: {resp.status_code} {resp.text}")
    return 0


def format_posts(posts: list) -> str:
    if not posts:
        return "(no posts)"
    lines = []
    for p in posts[:15]:
        community = p.get("community_name", "unknown")
        title = p.get("title", "")[:100]
        body = (p.get("body") or "")[:200]
        lines.append(f"  [r/{community}] {title}" + (f"\n  {body}" if body else ""))
    return "\n".join(lines)


def format_comments(comments: list) -> str:
    if not comments:
        return "(no comments)"
    lines = []
    for c in comments[:15]:
        community = c.get("community_name", "unknown")
        body = (c.get("body") or "")[:200]
        lines.append(f"  [r/{community}] {body}")
    return "\n".join(lines)


def process_user(user: dict, settings: dict, incremental: bool, lookback_days: int) -> int:
    user_id = user["id"]
    username = user["username"]

    if incremental:
        existing = fetch_existing_memory(user_id)
        if existing:
            import time as _time
            now = int(_time.time())
            most_recent = max(m.get("updated_at", 0) for m in existing)
            if now - most_recent < lookback_days * 86400:
                print(f"  Skipping {username} (memory updated within {lookback_days} days)")
                return 0

    posts = fetch_user_posts(user_id, limit=20)
    comments = fetch_user_comments(user_id, limit=20)

    if not posts and not comments:
        print(f"  Skipping {username} (no content)")
        return 0

    ollama_model = settings.get("ollama_model") or None
    ollama_temp = float(settings.get("ollama_temperature", 0.8))

    prompt = MEMORY_PROMPT.format(
        username=username,
        posts_text=format_posts(posts),
        comments_text=format_comments(comments),
    )

    raw = ollama_generate(prompt, model=ollama_model, temperature=ollama_temp)
    data = extract_json(raw)

    if not data:
        print(f"  FAILED to parse memory for {username}")
        return 0

    memories = []
    for item in data.get("opinions", []):
        if item.get("key") and item.get("value"):
            memories.append({
                "user_id": user_id,
                "memory_type": "opinion",
                "key": str(item["key"])[:100],
                "value": str(item["value"])[:500],
            })
    for item in data.get("topics", []):
        if item.get("key") and item.get("value"):
            memories.append({
                "user_id": user_id,
                "memory_type": "topic",
                "key": str(item["key"])[:100],
                "value": str(item["value"])[:500],
            })
    for item in data.get("community_familiarity", []):
        if item.get("key") and item.get("value"):
            memories.append({
                "user_id": user_id,
                "memory_type": "community_familiarity",
                "key": str(item["key"])[:100],
                "value": str(item["value"])[:500],
            })

    if memories:
        count = flush_memory(memories)
        print(f"  {username}: upserted {count} memory rows")
        return count
    return 0


def main():
    parser = argparse.ArgumentParser(description="Build user memory from posts and comments")
    parser.add_argument("--all-users", action="store_true", help="Process all AI users")
    parser.add_argument("--user-id", type=int, default=None, help="Process specific user by ID")
    parser.add_argument("--incremental", action="store_true", help="Skip users with recent memory (within --lookback-days)")
    parser.add_argument("--lookback-days", type=int, default=7, help="Skip users with memory updated within this many days (--incremental)")
    args = parser.parse_args()

    if not args.all_users and args.user_id is None:
        print("Specify --all-users or --user-id X")
        return

    settings = load_settings()

    if args.user_id:
        users_resp = req.get(
            f"{APP_API_URL}/internal/users/all",
            headers=INTERNAL_HEADERS,
            timeout=30,
        )
        if not users_resp.ok:
            print("Failed to fetch users")
            return
        users = [u for u in users_resp.json() if u["id"] == args.user_id]
        if not users:
            print(f"User {args.user_id} not found")
            return
    else:
        print("Fetching all AI users...")
        users = fetch_all_users()
        if not users:
            print("No users found.")
            return
        print(f"Found {len(users)} users")

    total = 0
    for i, user in enumerate(users):
        print(f"[{i+1}/{len(users)}] {user['display_name']} (@{user['username']})")
        total += process_user(user, settings, args.incremental, args.lookback_days)
        time.sleep(0.05)

    print(f"\nDone. Total memory rows upserted: {total}")


if __name__ == "__main__":
    main()
