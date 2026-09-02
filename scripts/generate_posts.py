"""Generate AI posts using a 3-stage pipeline: Premise → Body → Title.

The body is written in one unconstrained pass as raw text. An earlier version of
this script inserted an outline stage between premise and writing, which a small
model needed to stay coherent but which forces essay structure — even coverage,
logical progression, tidy conclusions — on a model that no longer needs the help.
"""

import argparse
import random
import re
import time
import json
import datetime
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, llm_generate, extract_json, load_settings, CURRENT_MODEL
from random_seed import random_ideation_hints, random_reddit_voice, random_reddit_excerpt


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
Your political lean: {user.get('political_lean') or 'centrist'}.

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


# Deliberately vague. Explicit word counts ("400-800 words") get followed so
# precisely that every post in a length bucket comes out the same shape.
_LENGTH_TARGETS = {
    "short": "Keep it short — a couple of paragraphs at most.",
    "medium": "A few paragraphs.",
    "long": "This one runs long. Take your time with it.",
}

# Rough output ceilings so a long post is never cut off mid-sentence.
_LENGTH_TOKENS = {"short": 400, "medium": 900, "long": 1800}


def build_body_prompt(user: dict, community: dict, premise: str, length_hint: str,
                      register_hint: str, opener: str | None, voice_rules: list[str],
                      excerpt: str) -> str:
    """Stage 2. Raw text out — no JSON.

    Wrapping prose in a JSON string makes models write flatter and safer, and
    forced a parse-retry on every malformed escape. The constraint list is also
    deliberately short: a large model complies with every rule you give it, and
    text that visibly satisfies eleven simultaneous style directives reads as
    synthetic no matter how good each individual rule was.
    """
    personality = json.loads(user.get("personality") or "[]")
    voice_block = "\n".join(f"- {r}" for r in voice_rules)

    post_style_section = ""
    if community.get("post_style_prompt"):
        post_style_section = f"\nHow people write in this community:\n{community['post_style_prompt']}\n"

    opener_section = ""
    if opener:
        opener_section = (
            f'\nStart somewhere near this line, in your own words:\n"{opener}"\n'
        )

    return f"""You are {user['display_name']}. Write a post for r/{community['name']}.

WHAT HAPPENED / WHAT YOU WANT TO SAY:
{premise}

You are feeling: {register_hint}
How you write: {user.get('writing_style') or 'conversational, natural Reddit prose'}
Your personality: {', '.join(personality) if personality else 'curious'}
{post_style_section}
Here is a real post in the register I mean. Match its texture — the rhythm, the
mess, the way it doesn't tie itself up. Do NOT reuse anything from its content:

---
{excerpt}
---

{voice_block}
- No markdown headers and no bullet lists. This is someone typing into a text box.
{opener_section}
{_LENGTH_TARGETS.get(length_hint, "A few paragraphs.")}

Write only the post body. No title, no preamble, no quotation marks around it."""


def build_title_prompt(user: dict, community: dict, body: str) -> str:
    """Stage 3. The title is written last, so it can actually match the post."""
    return f"""Here is a post you just wrote for r/{community['name']}:

{body[:1500]}

Write the title you put on it.

Sound like a person, not a headline. Your writing style is: {user.get('writing_style') or 'conversational'} — if that means
lowercase or sloppy, the title is too. Max 200 characters.

Reply with the title and nothing else — no quotes, no "Title:", no markdown."""


def build_title_only_prompt(user: dict, community: dict, premise: str) -> str:
    return f"""You are {user['display_name']}. Write a Reddit post title for r/{community['name']}.

PREMISE: {premise}
YOUR WRITING STYLE: {user.get('writing_style') or 'conversational'}

Write a title that hooks the reader. Sound like a real person, not a headline. Max 200 characters.

Respond with ONLY valid JSON:
{{
  "title": "the post title"
}}"""


# ── Output parsing ───────────────────────────────────────────────────────────

_TITLE_PREFIX_RE = re.compile(r'^\s*(?:title|post title)\s*[:\-]\s*', re.IGNORECASE)


def clean_title(raw: str | None, fallback_body: str = "") -> str | None:
    """Pull a usable title out of a free-text model response."""
    text = (raw or "").strip()
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        line = _TITLE_PREFIX_RE.sub("", line)
        line = line.strip().lstrip("#*_> ").rstrip("*_ ").strip()
        # Models like to wrap the answer in quotes despite being told not to
        if len(line) > 1 and line[0] in "\"'\u201c\u2018" and line[-1] in "\"'\u201d\u2019":
            line = line[1:-1].strip()
        if line:
            return line[:300]

    # Last resort: first sentence of the body
    first = fallback_body.strip().split("\n", 1)[0].strip()
    if first:
        return first[:300].rstrip(".,;:") or None
    return None


# Flair is derived in Python from the sampled format hint rather than asked for.
# It was a field on the old JSON writing stage and vanished with it; deriving it
# is both cheaper and more consistent than another model round trip.
_FLAIR_BY_KEYWORD = [
    ("rant", "Rant"),
    ("vent", "Rant"),
    ("complaint", "Rant"),
    ("advice", "Question"),
    ("question", "Question"),
    ("asshole", "AITA"),
    ("confession", "Confession"),
    ("how-to", "Guide"),
    ("update", "Update"),
    ("milestone", "Update"),
    ("win", "Update"),
    ("revenge", "Story"),
    ("story", "Story"),
    ("account", "Story"),
    ("tale", "Story"),
    ("hot take", "Discussion"),
    ("unpopular", "Discussion"),
]


def flair_for_format(format_hint: str, is_narrative: bool) -> str | None:
    lowered = format_hint.lower()
    for keyword, flair in _FLAIR_BY_KEYWORD:
        if keyword in lowered:
            return flair
    return "Story" if is_narrative else "Discussion"


# ── Validation ───────────────────────────────────────────────────────────────

# Premise validation is a backstop against a vacuous premise, nothing more.
#
# An earlier version required a digit or a proper noun to be present. That is a
# test for a *token type*, not for specificity, and it threw away perfectly
# concrete premises like "TIFU by systematically dismantling a local real estate
# developer's rezoning bid" — no numbers, no proper nouns, entirely specific.
# So the check now passes by default and only rejects on positive evidence of
# waffle, which is the failure mode that actually matters.

# Phrases that show up when the model retreats to generalities.
_VAGUE_RE = re.compile(
    r'\b(?:people\s+(?:these\s+days|in\s+general|nowadays|today)'
    r"|(?:in|about)\s+(?:today's|modern)\s+(?:world|society)"
    r'|(?:general|broader?)\s+(?:discussion|topic|question|thoughts?)'
    r'|how\s+people\s+(?:feel|think)\s+about'
    r'|(?:various|different|certain|some)\s+(?:things|topics|issues|aspects|ways)'
    r'|the\s+(?:importance|impact|nature|state)\s+of'
    r'|share\s+(?:my|some)\s+(?:thoughts|feelings)'
    r'|society\s+(?:as\s+a\s+whole|in\s+general))\b',
    re.IGNORECASE,
)

# Any of these is enough to override a vague-phrase hit — the premise names
# something real even if it also editorializes.
_CONCRETE_RE = re.compile(
    r'(\$\s?\d|\b\d'
    r'|\b(?:my|our|his|her|their)\s+\w+'      # "my landlord", "our HOA"
    r'|\b(?:last|this|next)\s+\w+'
    r'|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several)\s+'
    r'(?:of\s+)?\w+)',
    re.IGNORECASE,
)
_PROPER_NOUN_RE = re.compile(r'\b[A-Z][a-z]{2,}')


def is_valid_premise(premise: str) -> bool:
    words = premise.split()
    if len(words) < 12:
        return False
    if not _VAGUE_RE.search(premise):
        return True
    # Vague phrasing is forgivable if the premise still names something concrete
    tail = premise.split(None, 1)
    return bool(
        _CONCRETE_RE.search(premise)
        or (len(tail) > 1 and _PROPER_NOUN_RE.search(tail[1]))
    )


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
_recent_titles_lock = threading.Lock()


def fetch_recent_post_titles(community_name: str, limit: int = 10) -> list[str]:
    with _recent_titles_lock:
        cached = _recent_titles_cache.get(community_name)
    if cached is not None:
        return cached
    titles: list[str] = []
    try:
        resp = req.get(
            f"{APP_API_URL}/communities/{community_name}/posts",
            params={"sort": "new", "limit": limit},
            timeout=10,
        )
        if resp.ok:
            titles = [p["title"] for p in resp.json().get("items", [])]
    except Exception:
        pass
    with _recent_titles_lock:
        return _recent_titles_cache.setdefault(community_name, titles)


def note_generated_title(community_name: str, title: str, keep: int = 25) -> None:
    """Feed a just-generated title back into the avoid-list.

    Without this the cache is a snapshot from startup, so posts generated in the
    same run can't see each other and near-duplicates show up within one batch.
    """
    with _recent_titles_lock:
        titles = _recent_titles_cache.setdefault(community_name, [])
        titles.insert(0, title)
        del titles[keep:]


class UserPool:
    """A pre-fetched pool of users, drawn from at random.

    Replaces one HTTP round trip per post against /internal/users/random, which
    at high parallelism is a lot of traffic for a value we can batch.
    """

    def __init__(self, size: int):
        self.lock = threading.Lock()
        self.users = fetch_random_users(size)

    def take(self) -> dict | None:
        with self.lock:
            if not self.users:
                return None
            return random.choice(self.users)


def fetch_random_users(count: int) -> list:
    try:
        resp = req.get(
            f"{APP_API_URL}/internal/users/random",
            params={"count": count},
            headers=INTERNAL_HEADERS,
            timeout=30,
        )
        if resp.ok:
            return resp.json()
        print(f"  Failed to fetch users: {resp.status_code}")
    except Exception as e:
        print(f"  Failed to fetch users: {e}")
    return []


# ── 3-stage pipeline ─────────────────────────────────────────────────────────

def generate_post(
    user: dict,
    community: dict,
    recent_titles: list[str],
    target_date: datetime.date,
    temp_ideation: float,
    temp_writing: float,
    temp_title: float,
    viral_prob: float,
) -> dict | None:
    is_narrative = bool(community.get("is_narrative"))
    format_hint, length_hint, register_hint, angle_hint = random_ideation_hints(is_narrative)

    # ── Stage 1: Premise ─────────────────────────────────────────────────────
    ideation_prompt = build_ideation_prompt(
        user, community, recent_titles, format_hint, register_hint, angle_hint
    )
    raw1 = llm_generate(ideation_prompt, temperature=temp_ideation, n_predict=250)
    data1 = extract_json(raw1)
    if not data1 or not data1.get("premise"):
        print(f"    Stage 1 failed: no premise")
        return None

    premise = str(data1["premise"]).strip()
    if not is_valid_premise(premise):
        # One retry
        raw1b = llm_generate(ideation_prompt, temperature=temp_ideation, n_predict=250)
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

    def build_post(title: str, body: str, flair: str | None) -> dict:
        return {
            "community_name": community["name"],
            "username": user["username"],
            "title": title[:300],
            "body": body,
            "post_type": "text",
            "score": score,
            "upvote_count": upvotes,
            "downvote_count": downvotes,
            "flair": flair,
            "model": CURRENT_MODEL,
            "scheduled_at": random_scheduled_at(target_date),
            "created_at": now,
            "updated_at": now,
        }

    # Short-circuit: title-only posts have no body to title afterwards
    if is_title_only:
        title_prompt = build_title_only_prompt(user, community, premise)
        raw_t = llm_generate(title_prompt, temperature=temp_title, n_predict=256)
        data_t = extract_json(raw_t)
        if not data_t or not data_t.get("title"):
            print(f"    Title-only generation failed")
            return None
        return build_post(str(data_t["title"]), "", flair_for_format(format_hint, is_narrative))

    # ── Stage 2: Body (raw text) ─────────────────────────────────────────────
    # The opener is a strong steer, and there are only 25 of them. Applying one
    # to every post makes the repetition obvious across a few hundred posts.
    opener, voice_rules, _anti_robot = random_reddit_voice()
    body_prompt = build_body_prompt(
        user=user,
        community=community,
        premise=premise,
        length_hint=length_hint,
        register_hint=register_hint,
        opener=opener if random.random() < 0.3 else None,
        voice_rules=voice_rules[:2],
        excerpt=random_reddit_excerpt(),
    )
    body = llm_generate(
        body_prompt,
        temperature=temp_writing,
        n_predict=_LENGTH_TOKENS.get(length_hint, 900),
    )
    body = (body or "").strip()
    if len(body) < 40:
        print(f"    Stage 2 failed: body too short ({len(body)} chars)")
        return None

    # ── Stage 3: Title, written from the finished body ───────────────────────
    raw_title = llm_generate(
        build_title_prompt(user, community, body),
        temperature=temp_title,
        n_predict=100,
    )
    title = clean_title(raw_title, fallback_body=body)
    if not title:
        print(f"    Stage 3 failed: no usable title")
        return None

    return build_post(title, body, flair_for_format(format_hint, is_narrative))


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate AI posts for a given date")
    parser.add_argument("--date", default="today", help="Date in YYYY-MM-DD format or 'today'")
    parser.add_argument("--count", type=int, default=None, help="Number of posts to generate")
    parser.add_argument("--community", default=None, help="Only generate for this community slug")
    parser.add_argument("--parallel", type=int, default=1,
                        help="Number of posts to generate concurrently (default: 1)")
    args = parser.parse_args()
    args.parallel = max(1, args.parallel)

    settings = load_settings()
    viral_prob = float(settings.get("viral_post_probability", 0.05))

    temp_ideation = float(settings.get("post_ideation_temperature", 1.1))
    temp_writing = float(settings.get("post_writing_temperature", 1.0))
    temp_title = float(settings.get("post_title_temperature", 1.0))

    count_min = int(settings.get("posts_per_day_min", 50))
    count_max = int(settings.get("posts_per_day_max", 150))
    post_count = args.count if args.count is not None else random.randint(count_min, count_max)

    target_date = (
        datetime.date.today()
        if args.date == "today"
        else datetime.date.fromisoformat(args.date)
    )
    print(f"Generating {post_count} posts for {target_date} (premise → body → title)")
    print(f"Temperatures: ideation={temp_ideation}, writing={temp_writing}, title={temp_title}")

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
    tasks = [item["community"] for item in distribution for _ in range(item["count"])]
    for c in communities:
        fetch_recent_post_titles(c["name"])

    user_pool = UserPool(min(max(post_count, 25), 200))
    if not user_pool.users:
        print("No users found. Run generate_users.py first.")
        return

    def generate_one(community: dict) -> dict | None:
        user = user_pool.take()
        if not user:
            print(f"  No users found for r/{community['name']}, skipping")
            return None
        post = generate_post(
            user=user,
            community=community,
            # copy: note_generated_title mutates the cached list from other threads
            recent_titles=list(fetch_recent_post_titles(community["name"])),
            target_date=target_date,
            temp_ideation=temp_ideation,
            temp_writing=temp_writing,
            temp_title=temp_title,
            viral_prob=viral_prob,
        )
        if post:
            note_generated_title(post["community_name"], post["title"])
        return post

    batch = []
    total_inserted = 0
    generated = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = [pool.submit(generate_one, c) for c in tasks]
        for future in as_completed(futures):
            try:
                post = future.result()
            except Exception as e:
                post = None
                print(f"  Unexpected error: {e}")
            if not post:
                failed += 1
                continue

            generated += 1
            batch.append(post)
            print(f"  [{generated + failed}/{len(tasks)}] [{post['community_name']}] {post['title'][:60]}")
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
