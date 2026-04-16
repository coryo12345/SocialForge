"""Generate subreddit-equivalent communities via LLM and insert them into the database."""

import secrets
import json
import random
import math
import requests as req
from config import APP_API_URL, INTERNAL_HEADERS, ollama_generate, extract_json

COMMUNITY_SEEDS = [
    # News & Information
    {"name": "worldnews",          "topic": "global news and current events, geopolitics, international affairs, and breaking stories from around the world"},
    {"name": "technology",         "topic": "tech news, product launches, industry analysis, software and hardware releases, and the business of tech"},
    {"name": "science",            "topic": "scientific discoveries, peer-reviewed research, fascinating natural phenomena, emerging fields, and science communication"},
    {"name": "space",              "topic": "astronomy, space exploration, cosmology, NASA and SpaceX missions, exoplanet discoveries, and the science of the cosmos"},
    {"name": "history",            "topic": "historical events, forgotten stories, famous figures, cause-and-effect analysis, and what the past can teach us"},
    {"name": "environment",        "topic": "climate change, sustainability, conservation, renewable energy, environmental policy, and ecological news"},
    # Entertainment
    {"name": "gaming",             "topic": "video games of all kinds — AAA releases, indie gems, retro classics, gaming culture, esports, and industry news"},
    {"name": "movies",             "topic": "film discussion, new releases, director retrospectives, box office analysis, streaming recommendations, and movie trivia"},
    {"name": "television",         "topic": "TV shows and streaming — episode discussions, series reviews, cancellations, renewals, recaps, and hidden gems"},
    {"name": "music",              "topic": "music discovery, genre deep-dives, artist discussions, album reviews, concert experiences, and recommendations across all genres"},
    {"name": "books",              "topic": "reading, literature, book recommendations, author discussions, reading challenges, literary analysis, and what you're currently reading"},
    # Lifestyle
    {"name": "cooking",            "topic": "recipes, cooking techniques, kitchen tips, food science, restaurant experiences, cultural cuisine, and culinary traditions"},
    {"name": "fitness",            "topic": "working out, health, nutrition, training programs, injury recovery, body recomposition, and fitness motivation"},
    {"name": "travel",             "topic": "travel tips, destination recommendations, trip reports, visa advice, budget travel, and the joy of exploring the world"},
    {"name": "productivity",       "topic": "tools, habits, systems, time management, and workflows for doing meaningful work and living more intentionally"},
    # Finance & Career
    {"name": "personalfinance",    "topic": "budgeting, investing, debt payoff, the FIRE movement, career earnings, tax strategy, and money advice for all life stages"},
    {"name": "programming",        "topic": "software development — languages, frameworks, architecture, system design, debugging, career advice, and developer culture"},
    # Discussion & Debate
    {"name": "askforge",           "topic": "open-ended questions for the community — opinions, recommendations, hypotheticals, and life questions, anything goes"},
    {"name": "changemyview",       "topic": "present a position you hold and genuinely invite others to challenge it through logic, evidence, and civil argument — delta awards for mind-changing responses"},
    {"name": "unpopularopinion",   "topic": "contrarian takes and genuinely unpopular opinions — the more upvoted it is, the more suspicious we are that it's actually popular"},
    {"name": "philosophy",         "topic": "philosophical questions, ethical dilemmas, thought experiments, continental vs analytic debate, and exploring the ideas of great thinkers"},
    {"name": "dataisbeautiful",    "topic": "data visualizations, infographics, and statistical analyses that reveal surprising or counterintuitive patterns in the world"},
    # Casual & Humor
    {"name": "todayilearned",      "topic": "interesting facts and TIL posts — share something surprising, counterintuitive, or just cool that you recently learned about any topic"},
    {"name": "showerthoughts",     "topic": "random musings, unexpected observations, and half-baked philosophical tangents that feel profound in the shower or at 2am"},
    {"name": "mildlyinteresting",  "topic": "things that are exactly noteworthy enough to share — not jaw-dropping, not boring, precisely mildly interesting"},
    {"name": "localscene",         "topic": "neighborhood and city life — local events, urban observations, community issues, hyperlocal humor, and 'only in my city' moments"},
    # Advice & Relationships
    {"name": "lifeadvice",         "topic": "navigating major life decisions, personal growth, career crossroads, mental health, and situations where a stranger's outside perspective genuinely helps"},
    {"name": "relationships",      "topic": "dating, romance, friendship, family dynamics, and navigating the complexities and conflicts of human connection"},
    {"name": "relationshipadvice", "topic": "seeking advice on specific romantic situations, breakups, communication problems, and partner conflicts — practical guidance over judgment"},
    {"name": "sports",             "topic": "general sports discussion across all sports — scores, trades, hot takes, controversies, fan culture, and sports history"},
    # Storytelling & Drama
    {"name": "aita",               "topic": "Am I The Asshole — share a moral dilemma or interpersonal conflict and let the community render a verdict: YTA, NTA, ESH, or NAH"},
    {"name": "tifu",               "topic": "Today I F***ed Up — confessions of embarrassing, costly, or spectacularly disastrous mistakes and the chaos or consequences that followed"},
    {"name": "pettyrevenge",       "topic": "Personal stories of small, creative, and deeply satisfying acts of revenge against people who were rude, inconsiderate, or mildly deserving of comeuppance"},
    {"name": "nuclearrevenge",     "topic": "Personal stories of extreme, scorched-earth revenge that you took where someone went way further than necessary — and it was absolutely worth it"},
    {"name": "maliciouscompliance","topic": "following instructions or rules to the exact letter in a way that technically satisfies the request while spectacularly defeating its purpose"},
    {"name": "amioverreacting",    "topic": "sharing an emotional reaction to a situation and asking whether your response was proportionate — sometimes the answer is yes, sometimes no"},
    {"name": "bridezillas",        "topic": "wedding horror stories — out-of-control brides, grooms, and wedding parties who turned a celebration into a nightmare of entitlement and drama"},
    {"name": "rpghorrorstories",   "topic": "tabletop RPG nightmare experiences — problem players, power-tripping GMs, disruptive characters, rules lawyering, and campaigns that imploded spectacularly"},
    {"name": "idontworkherelady",  "topic": "stories of being mistaken for an employee somewhere — and the absurd, entitled, or hilarious interactions that followed when you either helped or didn't"},
    {"name": "entitledpeople",     "topic": "stories about people who behave as if the world owes them everything — Karens, entitled parents, boundary-stompers, and those who make everyone else's day worse"},
    # Meta
    {"name": "conspiracy",         "topic": "conspiracy theories, alternative explanations for historical events, and hidden connections — from satirical tongue-in-cheek to earnestly argued rabbit holes"},
]

PROMPT_TEMPLATE = """You are creating a community for a social platform.
Community name: {name}
Topic: {topic}

Respond with ONLY a JSON object with these exact fields:
- display_name (string, human-readable name, max 50 chars)
- description (string, 1-2 sentences about the community)
- sidebar_text (string, 2-4 sentences for the sidebar)
- rules (array of 3-5 rule strings, short and direct)
- tags (array of 2-4 topic tag strings)

No other text. Just the JSON object."""


def lognormal_member_count() -> int:
    """Log-normal distribution skewed toward lower values (1k–2.5M)."""
    mu, sigma = 10.0, 2.5
    raw = int(math.exp(random.gauss(mu, sigma)))
    return max(1_000, min(2_500_000, raw))


def main():
    communities = []
    for seed in COMMUNITY_SEEDS:
        print(f"Generating r/{seed['name']}...", end=" ", flush=True)
        prompt = PROMPT_TEMPLATE.format(**seed)
        raw = ollama_generate(prompt)
        data = extract_json(raw)

        if not data:
            print("FAILED (using defaults)")
            data = {
                "display_name": seed["name"],
                "description": seed["topic"][:200],
                "sidebar_text": seed["topic"][:200],
                "rules": ["Be respectful", "Stay on topic", "No spam"],
                "tags": [],
            }

        communities.append({
            "name": seed["name"],
            "display_name": str(data.get("display_name", seed["name"]))[:50],
            "description": str(data.get("description", "")),
            "sidebar_text": str(data.get("sidebar_text", "")),
            "rules": json.dumps(data.get("rules", [])),
            "tags": json.dumps(data.get("tags", [])),
            "icon_seed": secrets.token_hex(4),
            "banner_color": "#c4730a",
            "member_count": lognormal_member_count(),
        })
        print("ok")

    print(f"\nInserting {len(communities)} communities...", end=" ", flush=True)
    resp = req.post(
        f"{APP_API_URL}/internal/communities/bulk",
        json={"communities": communities},
        headers=INTERNAL_HEADERS,
    )
    if resp.ok:
        data = resp.json()
        print(f"ok ({data.get('inserted', '?')} inserted)")
    else:
        print(f"FAILED: {resp.status_code} {resp.text}")


if __name__ == "__main__":
    main()
