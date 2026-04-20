"""Generate user relationships based on overlapping interests."""

import argparse
import itertools
import json
import random
import time
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, llm_generate, extract_json, load_settings

RELATIONSHIP_PROMPT = """Two internet users have overlapping interests and may interact online.

User A: {name_a} ({age_a}-year-old {occupation_a}), personality: {personality_a}, interests: {interests_a}
User B: {name_b} ({age_b}-year-old {occupation_b}), personality: {personality_b}, interests: {interests_b}

They share interests in: {shared_interests}

What would their likely online relationship be?
- ally: mutual support, often agree, friendly
- rival: competitive or argumentative, often clash
- acquaintance: occasional interaction, mostly neutral
- fan: A follows/admires B, one-sided

Respond with ONLY valid JSON (no markdown):
{{"type": "ally|rival|acquaintance|fan", "strength": 0.1-1.0, "notes": "one sentence describing their dynamic"}}"""


def jaccard(a: list, b: list) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def fetch_all_users() -> list:
    resp = req.get(
        f"{APP_API_URL}/internal/users/all",
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        return resp.json()
    print(f"Failed to fetch users: {resp.status_code}")
    return []


def flush_relationships(batch: list) -> int:
    if not batch:
        return 0
    resp = req.post(
        f"{APP_API_URL}/internal/relationships/bulk",
        json={"relationships": batch},
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        inserted = resp.json().get("inserted", 0)
        print(f"  Inserted batch of {inserted} relationships")
        return inserted
    print(f"  FAILED batch: {resp.status_code} {resp.text}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Generate user relationships")
    parser.add_argument("--coverage", type=float, default=0.3, help="Fraction of users to create relationships for")
    parser.add_argument("--max-pairs", type=int, default=2000, help="Max relationship pairs to generate")
    parser.add_argument("--similarity-threshold", type=float, default=0.25, help="Minimum Jaccard similarity to consider")
    parser.add_argument("--dry-run", action="store_true", help="Preview without inserting")
    args = parser.parse_args()

    settings = load_settings()
    llm_temp = float(settings.get("llm_temperature", 0.8))

    print("Fetching all AI users...")
    all_users = fetch_all_users()
    if not all_users:
        print("No users found. Run generate_users.py first.")
        return
    print(f"Found {len(all_users)} users")

    # Parse interests for each user
    for u in all_users:
        u["_interests"] = json.loads(u.get("interests") or "[]")
        u["_personality"] = json.loads(u.get("personality") or "[]")

    # Select subset based on coverage
    target_count = max(10, int(len(all_users) * args.coverage))
    selected = random.sample(all_users, min(target_count, len(all_users)))
    print(f"Finding pairs among {len(selected)} users (coverage={args.coverage})")

    # Find high-similarity pairs
    candidates: list[tuple[dict, dict, float, list]] = []
    for a, b in itertools.combinations(selected, 2):
        shared = [i for i in a["_interests"] if i in b["_interests"]]
        sim = jaccard(a["_interests"], b["_interests"])
        if sim >= args.similarity_threshold and shared:
            candidates.append((a, b, sim, shared))

    # Sort by similarity descending, cap at max_pairs
    candidates.sort(key=lambda x: x[2], reverse=True)
    candidates = candidates[: args.max_pairs]
    print(f"Found {len(candidates)} candidate pairs above threshold {args.similarity_threshold}")

    if args.dry_run:
        print("\nDry run — showing first 5 pairs:")
        for a, b, sim, shared in candidates[:5]:
            print(f"  {a['display_name']} <-> {b['display_name']} | sim={sim:.2f} | shared={shared[:3]}")
        return

    batch = []
    total_inserted = 0
    succeeded = 0
    failed = 0

    for i, (a, b, sim, shared) in enumerate(candidates):
        print(f"[{i+1}/{len(candidates)}] {a['display_name']} <-> {b['display_name']} (sim={sim:.2f})")

        prompt = RELATIONSHIP_PROMPT.format(
            name_a=a["display_name"],
            age_a=a.get("age") or "adult",
            occupation_a=a.get("occupation") or "professional",
            personality_a=", ".join(a["_personality"]) if a["_personality"] else "normal",
            interests_a=", ".join(a["_interests"][:5]),
            name_b=b["display_name"],
            age_b=b.get("age") or "adult",
            occupation_b=b.get("occupation") or "professional",
            personality_b=", ".join(b["_personality"]) if b["_personality"] else "normal",
            interests_b=", ".join(b["_interests"][:5]),
            shared_interests=", ".join(shared[:5]),
        )

        raw = llm_generate(prompt, temperature=llm_temp)
        data = extract_json(raw)

        if not data or "type" not in data:
            print(f"  FAILED to parse relationship for {a['display_name']} <-> {b['display_name']}")
            failed += 1
            continue

        rel_type = data.get("type", "acquaintance")
        if rel_type not in ("ally", "rival", "acquaintance", "fan"):
            rel_type = "acquaintance"

        strength = min(1.0, max(0.1, float(data.get("strength", 0.5))))
        notes = str(data.get("notes", ""))[:500]

        batch.append({
            "user_id_a": a["id"],
            "user_id_b": b["id"],
            "relationship_type": rel_type,
            "strength": strength,
            "notes": notes,
        })
        succeeded += 1
        print(f"  → {rel_type} (strength={strength:.2f}): {notes[:80]}")

        if len(batch) >= 20:
            total_inserted += flush_relationships(batch)
            batch.clear()
            time.sleep(0.1)

    total_inserted += flush_relationships(batch)
    print(f"\nDone. {succeeded} generated, {total_inserted} inserted, {failed} failed")


if __name__ == "__main__":
    main()
