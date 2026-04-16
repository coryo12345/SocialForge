"""Generate AI user personas via LLM and insert them into the database."""

import argparse
import secrets
import json
import random
import string
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, ollama_generate, extract_json
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
- communication_style (string, 1 sentence describing how they write online)
- interests (array of 4-8 topic strings)
- political_lean (one of exactly: "far-left", "center-left", "centrist", "center-right", "far-right", "libertarian", "apolitical")

The username must begin with an actual english word starting with the letter '{random.choice(string.ascii_letters)}'
The display_name must be an actual human name starting with the letter '{random.choice(string.ascii_letters)}'

The person authentically embodies: {', '.join(user_seed_words)}

Respond ONLY with the JSON object, no other text."""

REQUIRED_FIELDS = [
    "username", "display_name", "bio", "age", "location", "occupation",
    "personality", "communication_style", "interests", "political_lean",
]

VALID_POLITICAL = {
    "far-left", "center-left", "centrist", "center-right",
    "far-right", "libertarian", "apolitical",
}


def generate_user() -> dict | None:
    for attempt in range(3):
        seeds = random_user_seeds()
        print("Generating with seeds: " + ', '.join(seeds))
        raw = ollama_generate(seeded_prompt_template(seeds))
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
            "communication_style": str(data["communication_style"]),
            "interests": json.dumps(
                data["interests"] if isinstance(data["interests"], list) else []
            ),
            "political_lean": data["political_lean"],
            "avatar_seed": secrets.token_hex(4),
        }

    return None


def main():
    parser = argparse.ArgumentParser(description="Generate AI user personas")
    parser.add_argument("--count", type=int, default=10, help="Number of users to generate")
    args = parser.parse_args()

    users_batch = []
    total_inserted = 0
    failed = 0

    for i in range(args.count):
        print(f"Generating user {i + 1}/{args.count}...", end=" ", flush=True)
        user = generate_user()

        if user:
            users_batch.append(user)
            print(f"ok (@{user['username']})")
        else:
            failed += 1
            print("FAILED")

        # Batch insert every 20 users or at the end
        if len(users_batch) >= 20 or (i == args.count - 1 and users_batch):
            resp = req.post(
                f"{APP_API_URL}/internal/users/bulk",
                json={"users": users_batch},
                headers=INTERNAL_HEADERS,
            )
            if resp.ok:
                inserted = resp.json().get("inserted", len(users_batch))
                total_inserted += inserted
                print(f"  → Batch inserted {inserted} users")
            else:
                print(f"  → Batch insert failed: {resp.status_code} {resp.text}")
            users_batch = []

    print(f"\nDone. {total_inserted} inserted, {failed} failed.")


if __name__ == "__main__":
    main()
