"""
generate_media_posts.py

STUB — Phase 3 placeholder. Media generation not yet implemented.

Future: This script will call a local image/video generation API
(e.g., ComfyUI for images, CogVideoX or similar for video) and
create posts with generated media.

For now, this script inserts posts with post_type='image' or 'video'
and null media_url, as a way to populate the DB with post stubs
that can be filled in later.
"""

import argparse
import random
import time
import datetime
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, load_settings

PLACEHOLDER_TITLES = {
    "image": [
        "Check out this photo I took",
        "Look at this",
        "Found this interesting image",
        "Photo from today",
        "Sharing this",
        "My latest photo",
        "Captured this moment",
    ],
    "video": [
        "Quick video I made",
        "Watch this",
        "Video I've been working on",
        "Short clip I wanted to share",
        "Recorded this today",
        "Check out this video",
    ],
}


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


def fetch_community(community_name: str | None) -> dict | None:
    resp = req.get(f"{APP_API_URL}/communities", timeout=10)
    if not resp.ok:
        return None
    communities = resp.json()
    if community_name:
        communities = [c for c in communities if c["name"] == community_name]
    return random.choice(communities) if communities else None


def main():
    parser = argparse.ArgumentParser(description="Insert media post stubs (Phase 3 placeholder)")
    parser.add_argument("--count", type=int, default=5, help="Number of posts to insert")
    parser.add_argument("--type", choices=["image", "video"], default="image", help="Media type")
    parser.add_argument("--community", default=None, help="Target community slug")
    parser.add_argument("--date", default="today", help="Scheduled date (YYYY-MM-DD or 'today')")
    args = parser.parse_args()

    target_date = (
        datetime.date.today()
        if args.date == "today"
        else datetime.date.fromisoformat(args.date)
    )

    community = fetch_community(args.community)
    if not community:
        print("No community found.")
        return

    print(f"Inserting {args.count} {args.type} post stubs into r/{community['name']} for {target_date}")

    now = int(time.time())
    batch = []

    for i in range(args.count):
        user = fetch_random_user()
        if not user:
            print("  No users found, skipping")
            continue

        title = random.choice(PLACEHOLDER_TITLES[args.type])
        hour = random.randint(9, 22)
        minute = random.randint(0, 59)
        dt = datetime.datetime(target_date.year, target_date.month, target_date.day, hour, minute)
        scheduled_at = int(dt.timestamp())

        post = {
            "community_name": community["name"],
            "username": user["username"],
            "title": title,
            "body": "",
            "post_type": args.type,
            "score": random.randint(1, 50),
            "scheduled_at": scheduled_at,
            "created_at": now,
            "updated_at": now,
        }
        batch.append(post)
        print(f"  [{i+1}/{args.count}] {args.type}: {title}")

    if batch:
        resp = req.post(
            f"{APP_API_URL}/internal/posts/bulk",
            json={"posts": batch},
            headers=INTERNAL_HEADERS,
            timeout=30,
        )
        if resp.ok:
            print(f"Inserted {resp.json().get('inserted', 0)} stub posts")
        else:
            print(f"Failed: {resp.status_code} {resp.text}")


if __name__ == "__main__":
    main()
