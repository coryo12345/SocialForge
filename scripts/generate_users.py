"""Generate AI user personas via LLM and insert them into the database."""

import argparse
import secrets
import json
import random
import string
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, llm_generate, extract_json, CURRENT_MODEL
from random_seed import random_user_seeds

def seeded_prompt_template(user_seed_words):
    return f"""Generate a realistic internet user persona as a JSON object with these exact fields:
- username (string, lowercase, letters/numbers/underscores only, 4-20 chars, unique-ish)
- display_name (string, 2-30 chars, can have spaces/capitals)
- bio (string, 1-2 sentences about themselves)
- age (integer, 18-65)
- location (string, "City, Country" format)
- occupation (string, their job or role)
- personality (array of 3-5 trait words, e.g. ["curious", "sarcastic", "introverted"])
- writing_style (string, 1-2 sentences describing ONLY prose mechanics: typical sentence length and rhythm, use of line breaks, punctuation habits, vocabulary level, formatting tendencies like lists or headers. Do NOT mention topics or content areas.)
- interests (array of 4-8 topic strings)
- political_lean (one of exactly: "far-left", "center-left", "centrist", "center-right", "far-right", "libertarian", "apolitical")

The username must begin with an actual english word starting with the letter '{random.choice(string.ascii_letters)}'
The display_name must be an actual human name starting with the letter '{random.choice(string.ascii_letters)}'

The person authentically embodies: {', '.join(user_seed_words)}

Respond ONLY with the JSON object, no other text."""

REQUIRED_FIELDS = [
    "username", "display_name", "bio", "age", "location", "occupation",
    "personality", "writing_style", "interests", "political_lean",
]

VALID_POLITICAL = {
    "far-left", "center-left", "centrist", "center-right",
    "far-right", "libertarian", "apolitical",
}


def generate_user() -> dict | None:
    for attempt in range(3):
        seeds = random_user_seeds()
        print("Generating with seeds: " + ', '.join(seeds))
        raw = llm_generate(seeded_prompt_template(seeds))
        data = extract_json(raw)

        if not data:
            print(f"  Retry {attempt + 1}: no JSON found")
            continue

        if not all(f in data for f in REQUIRED_FIELDS):
            missing = [f for f in REQUIRED_FIELDS if f not in data]
            print(f"  Retry {attempt + 1}: missing fields: {missing}")
            continue

        # Normalize and validate
        username = str(data["username"]).lower().strip()
        import re
        username = re.sub(r"[^a-z0-9_]", "_", username)[:20]
        if len(username) < 3:
            username = username + secrets.token_hex(2)

        if data.get("political_lean") not in VALID_POLITICAL:
            data["political_lean"] = "centrist"

        return {
            "username": username,
            "display_name": str(data["display_name"])[:30],
            "bio": str(data["bio"]),
            "age": int(data["age"]) if isinstance(data["age"], (int, float)) else None,
            "location": str(data["location"]),
            "occupation": str(data["occupation"]),
            "personality": json.dumps(
                data["personality"] if isinstance(data["personality"], list) else []
            ),
            "writing_style": str(data["writing_style"]),
            "interests": json.dumps(
                data["interests"] if isinstance(data["interests"], list) else []
            ),
            "political_lean": data["political_lean"],
            "avatar_seed": secrets.token_hex(4),
            "model": CURRENT_MODEL,
        }

    return None


def flush_users(batch: list) -> int:
    if not batch:
        return 0
    resp = req.post(
        f"{APP_API_URL}/internal/users/bulk",
        json={"users": batch},
        headers=INTERNAL_HEADERS,
    )
    if resp.ok:
        inserted = resp.json().get("inserted", len(batch))
        print(f"  → Batch inserted {inserted} users")
        return inserted
    print(f"  → Batch insert failed: {resp.status_code} {resp.text}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Generate AI user personas")
    parser.add_argument("--count", type=int, default=10, help="Number of users to generate")
    parser.add_argument("--parallel", type=int, default=1,
                        help="Number of users to generate concurrently (default: 1)")
    args = parser.parse_args()
    args.parallel = max(1, args.parallel)

    users_batch = []
    total_inserted = 0
    done = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = [pool.submit(generate_user) for _ in range(args.count)]
        for future in as_completed(futures):
            try:
                user = future.result()
            except Exception as e:
                user = None
                print(f"Unexpected error: {e}")
            done += 1

            if user:
                users_batch.append(user)
                print(f"[{done}/{args.count}] ok (@{user['username']})")
            else:
                failed += 1
                print(f"[{done}/{args.count}] FAILED")

            if len(users_batch) >= 5:
                total_inserted += flush_users(users_batch)
                users_batch = []

    total_inserted += flush_users(users_batch)
    print(f"\nDone. {total_inserted} inserted, {failed} failed.")


if __name__ == "__main__":
    main()
