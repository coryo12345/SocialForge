"""Generate AI posts using a 3-stage pipeline: Ideation → Outline → Writing."""

import argparse
import random
import re
import time
import json
import datetime
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, llm_generate, extract_json, load_settings, CURRENT_MODEL
from random_seed import random_ideation_hints, random_reddit_voice


# ── Stage prompt builders ────────────────────────────────────────────────────

def build_ideation_prompt(user: dict, community: dict, recent_titles: list[str],
                          format_hint: str, register_hint: str, angle_hint: str) -> str:
    personality = json.loads(user.get("personality") or "[]")
    interests = json.loads(user.get("interests") or "[]")
    is_narrative = bool(community.get("is_narrative"))

    if is_narrative:
        narrative_instruction = (
            "This community is for personal stories. Your premise must describe a real incident: "
            "who the other person was, what they did, and what you did in response."
        )
    else:
        community_topic = community.get("description") or community["name"]
        narrative_instruction = (
            f"This community is for {community_topic}. Your premise should describe a specific "
            "question, rant, experience, or opinion — not a general discussion topic."
        )

    recent_section = ""
    if recent_titles:
        recent_section = f"Do NOT write about any of these recently posted topics: {recent_titles}\n\n"

    return f"""You are {user['display_name']}, a {user.get('age') or 'unknown'}-year-old {user.get('occupation') or 'professional'} from {user.get('location') or 'somewhere'}.
About you: {user.get('bio') or 'No bio available.'}
Your personality: {', '.join(personality) if personality else 'curious'}.
Your interests: {', '.join(interests) if interests else 'various topics'}.

You are about to write a post in r/{community['name']}.
{narrative_instruction}

Tone hint for this post: {register_hint}
Angle hint: {angle_hint}
Format hint: {format_hint}

Come up with a SPECIFIC, CONCRETE premise for a post. Name real circumstances.
Do not be generic. Do not summarize. If your premise could apply to anyone, it is too vague.

{recent_section}Respond with ONLY a JSON object:
{{
  "premise": "one or two sentences describing the specific situation or question for this post",
  "is_title_only": false
}}"""


_OUTLINE_BULLET_COUNTS = {"short": "2-3", "medium": "4-5", "long": "6-8"}


def build_outline_prompt(user: dict, community: dict, premise: str, length_hint: str) -> str:
    personality = json.loads(user.get("personality") or "[]")
    is_narrative = bool(community.get("is_narrative"))
    community_type = "personal story community" if is_narrative else "discussion community"
    bullet_count = _OUTLINE_BULLET_COUNTS.get(length_hint, "4-5")
    post_style_section = ""
    if community.get("post_style_prompt"):
        post_style_section = f"\nPosting style for this community:\n{community['post_style_prompt']}\n"

    return f"""You are {user['display_name']}. You have a post idea:

PREMISE: {premise}

You are posting in r/{community['name']} ({community_type}).
Your personality: {', '.join(personality) if personality else 'curious'}.
Your political lean: {user.get('political_lean') or 'centrist'}.
{post_style_section}
Write {bullet_count} rough draft sentences capturing what this post will actually say.
These are NOT structural labels like "describe the conflict" — write the actual content.
Each entry should be a real sentence or two that you will say or describe in the post.
Think of it as jotting down the main points before writing the full version.

Respond with ONLY a **VALID** JSON object:
{{
  "outline": ["draft sentence 1", "draft sentence 2", ...]
}}"""


_LENGTH_WORD_TARGETS = {"short": "50-150", "medium": "150-350", "long": "400-800"}


def build_writing_prompt(user: dict, community: dict, premise: str, outline: list[str],
                         length_hint: str, opener: str, voice_rules: list[str],
                         anti_robot: list[str]) -> str:
    personality = json.loads(user.get("personality") or "[]")
    numbered = "\n".join(f"{i+1}. {point}" for i, point in enumerate(outline))
    word_target = _LENGTH_WORD_TARGETS.get(length_hint, "150-350")
    voice_block = "\n".join(f"- {r}" for r in voice_rules)
    anti_block = "\n".join(f"- {r}" for r in anti_robot)
    post_style_section = ""
    if community.get("post_style_prompt"):
        post_style_section = f"\nCOMMUNITY POSTING STYLE — follow this:\n{community['post_style_prompt']}\n"

    return f"""You are {user['display_name']}. Write a Reddit post for r/{community['name']}.

YOUR PREMISE: {premise}

YOUR DRAFT POINTS (cover all of these, in order):
{numbered}

YOUR WRITING STYLE: {user.get('writing_style') or 'conversational, natural Reddit prose'}
YOUR PERSONALITY: {', '.join(personality) if personality else 'curious'}
{post_style_section}
VOICE — follow these:
{voice_block}

AVOID:
{anti_block}

OPENER: Start your post body with or near this line — adapt it naturally, do not copy verbatim:
"{opener}"

TARGET LENGTH: {word_target} words for the body. Match this range — don't pad, don't cut short.

Respond with ONLY valid JSON. You MUST include a title. Use commas between all properties.
{{
  "title": "post title (max 300 chars)",
  "body": "full post body",
  "flair": "Discussion / Rant / Question / Story / etc, or null"
}}"""


def build_title_only_prompt(user: dict, community: dict, premise: str) -> str:
    return f"""You are {user['display_name']}. Write a Reddit post title for r/{community['name']}.

PREMISE: {premise}
YOUR WRITING STYLE: {user.get('writing_style') or 'conversational'}

Write a title that hooks the reader. Sound like a real person, not a headline. Max 200 characters.

Respond with ONLY valid JSON:
{{
  "title": "the post title"
}}"""


# ── Validation ───────────────────────────────────────────────────────────────

_SPECIFIC_NOUN_RE = re.compile(
    r'\b(\d+[\.,]?\d*\s*(dollar|cent|year|month|week|day|hour|minute|k|%|lb|kg|miles?|km)?'
    r'|\$\d+'
    r'|[A-Z][a-z]{2,}'  # Capitalized proper noun
    r'|yesterday|today|tomorrow|last\s+\w+|this\s+\w+)\b',
    re.IGNORECASE,
)


def is_valid_premise(premise: str) -> bool:
    if len(premise.split()) < 15:
        return False
    if not _SPECIFIC_NOUN_RE.search(premise):
        return False
    return True


# ── Utility ──────────────────────────────────────────────────────────────────

def random_score(viral_prob: float = 0.05) -> tuple[int, int, int]:
    """Returns (score, upvote_count, downvote_count) using Pareto distribution."""
    base = random.paretovariate(1.5)
    score = int(base * 3)
    if random.random() < viral_prob:
        score = random.randint(500, 5000)
    score = min(score, 10000)
    ratio = random.uniform(0.85, 0.99)
    upvotes = max(score, int(score / ratio)) if score > 0 else random.randint(0, 5)
    downvotes = max(0, upvotes - score)
    return score, upvotes, downvotes


def flush_posts(batch: list) -> int:
    if not batch:
        return 0
    resp = req.post(
        f"{APP_API_URL}/internal/posts/bulk",
        json={"posts": batch},
        headers=INTERNAL_HEADERS,
        timeout=30,
    )
    if resp.ok:
        inserted = resp.json().get("inserted", 0)
        print(f"  Inserted batch of {inserted}")
        return inserted
    else:
        print(f"  FAILED batch insert: {resp.status_code} {resp.text}")
        return 0


def random_scheduled_at(date: datetime.date) -> int:
    """Return a Unix timestamp within the given date, weighted toward daytime hours."""
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


# ── 3-stage pipeline ─────────────────────────────────────────────────────────

def generate_post_3stage(
    user: dict,
    community: dict,
    recent_titles: list[str],
    target_date: datetime.date,
    temp_ideation: float,
    temp_outline: float,
    temp_writing: float,
    viral_prob: float,
) -> dict | None:
    is_narrative = bool(community.get("is_narrative"))
    format_hint, length_hint, register_hint, angle_hint = random_ideation_hints(is_narrative)

    # Stage 1: Ideation
    ideation_prompt = build_ideation_prompt(
        user, community, recent_titles, format_hint, register_hint, angle_hint
    )
    raw1 = llm_generate(ideation_prompt, temperature=temp_ideation)
    data1 = extract_json(raw1)
    if not data1 or not data1.get("premise"):
        print(f"    Stage 1 failed: no premise")
        return None

    premise = str(data1["premise"]).strip()
    if not is_valid_premise(premise):
        # One retry
        raw1b = llm_generate(ideation_prompt, temperature=temp_ideation)
        data1b = extract_json(raw1b)
        if data1b and data1b.get("premise"):
            premise = str(data1b["premise"]).strip()
        if not is_valid_premise(premise):
            print(f"    Stage 1 failed validation: premise too vague: {premise[:60]}")
            return None

    is_title_only = bool(data1.get("is_title_only", False))
    print(f"    Premise: {premise[:80]}")

    now = int(time.time())
    score, upvotes, downvotes = random_score(viral_prob)

    # Short-circuit: title-only posts skip outline + full writing
    if is_title_only:
        title_prompt = build_title_only_prompt(user, community, premise)
        raw_t = llm_generate(title_prompt, temperature=temp_writing, n_predict=1024)
        data_t = extract_json(raw_t)
        if not data_t or not data_t.get("title"):
            print(f"    Title-only generation failed")
            return None
        return {
            "community_name": community["name"],
            "username": user["username"],
            "title": str(data_t["title"])[:300],
            "body": "",
            "post_type": "text",
            "score": score,
            "upvote_count": upvotes,
            "downvote_count": downvotes,
            "flair": None,
            "model": CURRENT_MODEL,
            "scheduled_at": random_scheduled_at(target_date),
            "created_at": now,
            "updated_at": now,
        }

    # Stage 2: Outline (with dynamic bullet count from length_hint)
    outline_prompt = build_outline_prompt(user, community, premise, length_hint)
    raw2 = llm_generate(outline_prompt, temperature=temp_outline)
    data2 = extract_json(raw2)
    if not data2 or not isinstance(data2.get("outline"), list) or len(data2["outline"]) < 2:
        print(f"    Stage 2 failed: no outline")
        return None

    max_bullets = int(_OUTLINE_BULLET_COUNTS.get(length_hint, "4-5").split("-")[1])
    outline = [str(b) for b in data2["outline"][:max_bullets]]

    # Stage 3: Writing (with Reddit voice injection)
    opener, voice_rules, anti_robot = random_reddit_voice()
    writing_prompt = build_writing_prompt(
        user, community, premise, outline, length_hint, opener, voice_rules, anti_robot
    )
    raw3 = llm_generate(writing_prompt, temperature=temp_writing)
    data3 = extract_json(raw3)
    if not data3:
        print(f"    Stage 3: Not valid JSON, trying again...")
        raw3 = llm_generate(writing_prompt, temperature=temp_writing)
        data3 = extract_json(raw3)
    if not data3:
        print(f"    Stage 3 failed: invalid JSON")
        return None
    if "title" not in data3:
        print(f"    Stage 3 failed: no title in output")
        return None

    body = str(data3.get("body") or "")

    return {
        "community_name": community["name"],
        "username": user["username"],
        "title": str(data3["title"])[:300],
        "body": body,
        "post_type": "text",
        "score": score,
        "upvote_count": upvotes,
        "downvote_count": downvotes,
        "flair": data3.get("flair"),
        "model": CURRENT_MODEL,
        "scheduled_at": random_scheduled_at(target_date),
        "created_at": now,
        "updated_at": now,
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate AI posts for a given date")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--count", type=int, default=None, help="Number of posts to generate")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    args = parser.parse_args()

    settings = load_settings()
    viral_prob = float(settings.get("viral_post_probability", 0.05))

    temp_ideation = float(settings.get("post_ideation_temperature", 0.9))
    temp_outline = float(settings.get("post_outline_temperature", 0.75))
    temp_writing = float(settings.get("post_writing_temperature", 0.7))

    count_min = int(settings.get("posts_per_day_min", 50))
    count_max = int(settings.get("posts_per_day_max", 150))
    post_count = args.count if args.count is not None else random.randint(count_min, count_max)

    target_date = (
        datetime.date.today()
        if args.date == "today"
        else datetime.date.fromisoformat(args.date)
    )
    print(f"Generating {post_count} posts for {target_date} (3-stage pipeline)")
    print(f"Temperatures: ideation={temp_ideation}, outline={temp_outline}, writing={temp_writing}")

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

    distribution = weighted_distribution(communities, post_count)
    batch = []
    total_inserted = 0
    generated = 0
    failed = 0

    for item in distribution:
        community = item["community"]
        recent_titles = fetch_recent_post_titles(community["name"])

        for _ in range(item["count"]):
            user = fetch_random_user()
            if not user:
                print(f"  No users found for r/{community['name']}, skipping")
                failed += 1
                continue

            print(f"  [{community['name']}] @{user['username']} — generating...")
            post = generate_post_3stage(
                user=user,
                community=community,
                recent_titles=recent_titles,
                target_date=target_date,
                temp_ideation=temp_ideation,
                temp_outline=temp_outline,
                temp_writing=temp_writing,
                viral_prob=viral_prob,
            )

            if not post:
                failed += 1
                continue

            batch.append(post)
            generated += 1
            print(f"    Title: {post['title'][:60]}")
            if len(batch) >= 5:
                total_inserted += flush_posts(batch)
                batch.clear()

    if generated == 0:
        print("No posts generated.")
        return

    total_inserted += flush_posts(batch)
    print(f"\nSummary: {generated} generated, {total_inserted} inserted, {failed} failed, date={target_date}")


if __name__ == "__main__":
    main()
