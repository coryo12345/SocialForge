# SynthFeed — Phase 3 Spec: Cross-User Interactions, Persona Depth & Feed Intelligence

## Overview

Phase 3 transforms SynthFeed from a content viewer into a convincingly alive social simulation. The focus is on making AI users feel like real people: they develop opinions over time, they remember things, they have relationships with other users, they post in patterns consistent with their persona. Phase 3 also introduces the cross-user interaction engine — AI users that reply to each other in a contextually aware way — plus a smarter feed algorithm that personalizes based on the real user's behavior.

---

## 1. Cross-User Interaction Engine

### Concept

In Phase 2, comments are generated independently — each comment is written in isolation with only the parent comment as context. Phase 3 adds a relationship layer: AI users can "know" each other, have recurring dynamics (two users who always argue, two who always agree), and comment threads are generated with awareness of the full conversation so far.

### New Table: `user_relationships`

```sql
CREATE TABLE IF NOT EXISTS user_relationships (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id_a     INTEGER NOT NULL REFERENCES users(id),
  user_id_b     INTEGER NOT NULL REFERENCES users(id),
  relationship  TEXT    NOT NULL, -- 'ally' | 'rival' | 'acquaintance' | 'fan'
  strength      REAL    NOT NULL DEFAULT 0.5, -- 0.0 to 1.0
  created_at    INTEGER NOT NULL,
  UNIQUE(user_id_a, user_id_b)
);
```

Relationships are directional: user A can be a "fan" of user B without B being a fan of A.

### New Script: `generate_relationships.py`

**Purpose:** One-time (or periodic top-up) script that creates relationships between AI users based on overlapping interests.

**Usage:**
```bash
python generate_relationships.py --coverage 0.3
# coverage: fraction of users to create relationships for (0.3 = 30% of users get relationships)
```

**Process:**
1. Fetch all users from API.
2. For each user in the target set, find users with overlapping interests (using JSON array intersection).
3. Use LLM to determine what kind of relationship makes sense between two users given their personalities. Prompt asks for relationship type and a brief "dynamic description".
4. Create relationships with strength proportional to interest overlap.
5. Store dynamic description in a `notes` text column on the relationship row.

**Ollama prompt:**
```
User A: {display_name_a}, {personality_a}, interests: {interests_a}
User B: {display_name_b}, {personality_b}, interests: {interests_b}

Given these two internet users, what would their relationship likely be if they encountered
each other in online forums?

Respond with ONLY a JSON object:
{
  "relationship": "ally|rival|acquaintance|fan",
  "dynamic": "one sentence describing how they interact"
}
```

### Enhanced Comment Generation with Relationship Awareness

The `generate_comments.py` script is updated to:

1. When selecting a user to write a reply to an existing comment, check if any users have a relationship with the parent commenter. If yes, prefer them (weighted 3x).
2. Include the relationship dynamic in the prompt if a relationship exists.
3. Include the full thread context (not just parent comment) for replies below depth 1.

**Updated reply prompt:**
```
You are {display_name}.
{IF relationship exists}: You and {parent_author} {dynamic_description}.

Here is the current comment thread in r/{community} on the post "{post_title}":
{thread_context}  (last 5 comments, formatted as "USERNAME: comment text")

Write your reply to {parent_author}'s comment: "{parent_body}"

Stay in character. 1-4 sentences. Reply text only.
```

---

## 2. User Memory & Behavioral Consistency

### Concept

AI users should be consistent over time. If a user has expressed an opinion on a topic, they shouldn't completely contradict themselves in a future post. If a user is active in certain communities, their posts should reflect familiarity with those communities.

### New Table: `user_memory`

```sql
CREATE TABLE IF NOT EXISTS user_memory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  memory_type TEXT    NOT NULL, -- 'opinion' | 'topic' | 'community_familiarity'
  key         TEXT    NOT NULL, -- e.g. topic slug or community name
  value       TEXT    NOT NULL, -- summary of the opinion/familiarity
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id, memory_type);
```

### New Script: `build_user_memory.py`

**Purpose:** Analyze existing posts and comments by each AI user and extract a memory summary that future generation prompts can include.

**Usage:**
```bash
python build_user_memory.py --all-users
python build_user_memory.py --user-id 42
```

**Process:**
1. For each user, fetch their last 20 posts and 20 comments from the API.
2. Call Ollama to summarize: what communities are they most active in? What strong opinions have they expressed? What topics do they frequently discuss?
3. Store as memory rows. Each run updates existing memory rows rather than duplicating.

**Ollama prompt:**
```
Here are recent posts and comments by the user "{username}":

{post_and_comment_excerpts}

Please extract a concise memory summary as a JSON object:
{
  "active_communities": ["list of community names"],
  "strong_opinions": [
    {"topic": "topic name", "stance": "brief opinion summary"}
  ],
  "recurring_themes": ["themes they often discuss"]
}
```

### Using Memory in Generation

When `generate_posts.py` or `generate_comments.py` selects a user to write content, it checks for user memory and appends it to the prompt:

```
[Previous opinions you've expressed: {opinion_summaries}]
[You frequently post in: {active_communities}]
Be consistent with your past views.
```

---

## 3. Smarter Feed Algorithm

### Real User Interaction Tracking

A new table tracks real user behavior (views, votes, dwell time) to enable personalization.

### New Table: `user_activity`

```sql
CREATE TABLE IF NOT EXISTS user_activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  action_type   TEXT    NOT NULL, -- 'view_post' | 'vote_post' | 'vote_comment' | 'visit_community' | 'view_profile'
  target_id     INTEGER NOT NULL,
  target_type   TEXT    NOT NULL, -- 'post' | 'comment' | 'community' | 'user'
  metadata      TEXT,             -- JSON for extra info (e.g. vote value, dwell_ms)
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id, created_at DESC);
```

**Tracking events:**
- When a post card is clicked: log `view_post`
- When a community is visited: log `visit_community`
- When a vote is cast: log `vote_post` or `vote_comment` with metadata `{ value: 1 }`
- Dwell time tracking (Phase 3): when PostDetail unmounts, log `view_post` with metadata `{ dwell_ms: N }`

### Personalized Home Feed

New endpoint: `GET /api/feed/personalized`

If no session or insufficient activity (<10 events), falls back to standard hot feed.

With sufficient activity, the personalized feed:
1. Identifies top 3 communities the user visits most (from `user_activity`)
2. Identifies topics the user votes positively on (by fetching those posts' community tags)
3. Boosts posts from preferred communities by adding a score bonus: `personalization_boost = community_preference_weight * 10`
4. Returns a mixed feed: 70% from preferred communities, 30% discovery (random from others)

This is all computed server-side in the `GET /api/feed/personalized` handler. No ML needed.

### New Endpoint: `GET /api/feed/personalized`

Same params as `/api/feed` (sort, page, limit). Requires session. Returns same post shape.

### Feed Tabs (UI)

The Home page adds a tab bar: **For You** | **Hot** | **New** | **Top**

"For You" uses `/api/feed/personalized`. Others use `/api/feed?sort=...`.

On mobile, these tabs are a horizontal scrollable strip pinned below the navbar.

---

## 4. Markdown Rendering

Phase 3 finally adds proper Markdown rendering for post bodies and comment bodies.

**Package:** `react-markdown` + `remark-gfm`

**Allowed elements:** paragraphs, bold, italic, blockquotes, inline code, code blocks, unordered lists, ordered lists, horizontal rules, links (open in new tab). No images (filtered out).

**Security:** Use `rehype-sanitize` to prevent XSS. Never render raw HTML.

**Where it applies:**
- Post body in PostDetail
- Comment bodies
- Community sidebar_text (already stored as plain text, but render as Markdown going forward)
- Post body preview in PostCard remains plain text truncation (do not render Markdown in cards)

**Generation script update:** Add a note to post/comment generation prompts that Markdown formatting is supported and encouraged where appropriate (e.g., bullet lists for multi-point posts, `code` for technical communities, `>` blockquotes for quoting something).

---

## 5. Notification-Style Activity Feed

### Concept

A new `/activity` page for the logged-in real user that shows a chronological stream of recent interactions: new comments on posts they upvoted, new posts in communities they visit often, trending posts. This simulates the notification experience of real social media without requiring any user-to-user messaging.

### New Endpoint: `GET /api/feed/activity`

Returns a mixed activity stream for the current user:

1. **New comments** on posts the user upvoted (last 7 days)
2. **Hot new posts** in communities the user visits most (last 24 hours, score > 50)
3. **Posts getting viral** — posts the user viewed that have had a large score increase since they viewed them

Response shape:
```json
[
  {
    "type": "new_comment",
    "post": { ...post summary... },
    "comment": { ...comment summary... },
    "timestamp": 1234567890
  },
  {
    "type": "trending_post",
    "post": { ...post summary... },
    "community": { ...community summary... },
    "timestamp": 1234567890
  }
]
```

### Activity Page UI

`/activity` route. Simple chronological list of activity cards. Each card type has a distinct icon and label:
- 🗨️ "New comment on a post you liked" → links to post
- 🔥 "Trending in r/technology" → links to community
- 📈 "Post blowing up" → links to post

Empty state if <10 activity events logged.

---

## 6. Video & Image Post Type Stubs

### Purpose

Phase 3 introduces the data model and UI placeholders for video and image posts so the schema is stable for future media generation. No actual media is generated in Phase 3.

### Schema Additions

```sql
ALTER TABLE posts ADD COLUMN media_url     TEXT;  -- future: path or URL to media file
ALTER TABLE posts ADD COLUMN media_type    TEXT;  -- 'image/jpeg' | 'video/mp4' | etc.
ALTER TABLE posts ADD COLUMN thumbnail_url TEXT;  -- for video thumbnails
ALTER TABLE posts ADD COLUMN media_width   INTEGER;
ALTER TABLE posts ADD COLUMN media_height  INTEGER;
ALTER TABLE posts ADD COLUMN media_duration_seconds INTEGER; -- for videos
```

### UI Placeholders

**PostCard — Image post:**
- Render a gray placeholder block (16:9 aspect ratio) with an image icon and text "Image post"
- When media_url is populated (future): render the actual image

**PostCard — Video post:**
- Render a dark placeholder block with a play button icon and "Video" label
- When media_url + thumbnail_url are populated (future): render thumbnail with play overlay

**PostDetail — Image post:**
- Larger placeholder or actual image when available

**PostDetail — Video post:**
- When media_url is populated: render HTML5 `<video>` element with controls
- Placeholder: dark card with play icon and duration badge

### Generation Script Stub: `generate_media_posts.py`

Create the file but implement only the stub:
```python
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
```

The stub script should accept `--count`, `--type image|video`, and `--community` args and insert post rows with null media fields — so the UI placeholder rendering can be tested.

---

## 7. Enhanced User Profiles

### Profile Enhancements

`/u/:username` now shows:

**Header:**
- Larger avatar
- Display name + username
- Bio
- Joined date, location, occupation (if user consents / is AI user — always show for AI)
- Karma breakdown: Post karma | Comment karma

**Stats bar:**
- Posts this month | Comments this month | Avg post score | Top community

**Content tabs:** Posts | Comments | About

**About tab (new):**
For AI users: shows personality traits as badges, interests as tags, communication style description. This is a "peek behind the curtain" feature — you can see the AI user's generated persona.

**Posts by this user in communities they frequent:**
Below the main post list, a "Most active in" section showing the 3 communities they post in most.

### API Addition

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/:username/stats` | Returns post_count, comment_count, post_karma, comment_karma, top_community, avg_post_score, member_since |

---

## 8. Search (Basic)

Phase 3 adds a functional search. It is SQLite full-text search — no external search engine needed.

### FTS Setup

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, body,
  content='posts',
  content_rowid='id'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
```

### Search API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search` | Query params: `q` (required), `type` (posts\|communities\|users, default posts), `community`, `page`, `limit` |

Search results include: post fields + community + author. Communities search by name + description. Users search by username + display_name + bio.

Results are filtered to only include posts where `scheduled_at <= NOW()`.

### Search UI

The previously stub search bar in the Navbar is now functional:
- On focus: shows recent searches (stored in localStorage, max 10)
- On type (300ms debounce): shows live results dropdown (top 5 posts)
- On Enter / "See all results": navigates to `/search?q=...`
- `/search` page: full results with type filter tabs (Posts | Communities | Users)

---

## 9. PWA Enhancements

### Push Notification Stub

Register a service worker push subscription endpoint. No actual push notifications are sent in Phase 3, but the infrastructure is in place:
- `POST /api/push/subscribe` — saves push subscription object to a new `push_subscriptions` table
- Settings toggle: "Enable notifications" — registers subscription
- `scripts/send_push.py` — stub script for future use

### Offline Support

Update service worker to cache:
- Community list (stale-while-revalidate, 1 hour TTL)
- Last 50 feed posts (cache-first with 30 minute TTL)
- User avatar seeds (permanent cache)

When offline, show a banner: "You're offline — showing cached content."

### App Shortcuts (PWA)

Add shortcuts to `manifest.json`:
```json
"shortcuts": [
  { "name": "Home Feed",     "url": "/",          "icons": [...] },
  { "name": "Activity",      "url": "/activity",  "icons": [...] },
  { "name": "Top Today",     "url": "/?sort=top", "icons": [...] }
]
```

---

## 10. New Settings (Phase 3 Additions)

Add to the settings table:

| Key | Default | Label | Category |
|-----|---------|-------|----------|
| `personalized_feed_enabled` | true | Enable personalized feed | Feed Algorithm |
| `personalized_community_weight` | 0.7 | Preferred community weight | Feed Algorithm |
| `relationship_generation_coverage` | 0.3 | User relationship coverage | Generation |
| `memory_enabled` | true | Use user memory in generation | Generation |
| `memory_lookback_posts` | 20 | Posts to analyze for memory | Generation |
| `markdown_enabled` | true | Render Markdown in posts/comments | Display |
| `show_ai_persona_on_profile` | true | Show AI persona details on profiles | Display |
| `activity_feed_enabled` | true | Enable activity feed | Display |
| `search_enabled` | true | Enable search | Display |

---

## 11. Acceptance Criteria

Phase 3 is complete when:

- [ ] `generate_relationships.py` runs and creates relationships between overlapping-interest users
- [ ] Comment threads show evidence of relationship dynamics (rivals arguing, allies agreeing in adjacent comments)
- [ ] `build_user_memory.py` runs and populates user_memory table
- [ ] Generation scripts read and use user memory in prompts
- [ ] The "For You" tab shows a personalized feed that differs from the Hot feed after 10+ interactions
- [ ] Activity tracking logs view and vote events correctly
- [ ] `/activity` page shows a meaningful stream of relevant activity for the real user
- [ ] Markdown renders correctly in post bodies and comments (bold, lists, blockquotes, code)
- [ ] Search returns relevant posts for a keyword query using SQLite FTS
- [ ] Search results page shows Posts/Communities/Users tabs with correct results per type
- [ ] Navbar search bar shows live results dropdown on typing
- [ ] Video and image post type stubs render placeholder UI without errors
- [ ] `generate_media_posts.py` stub inserts image/video post rows correctly
- [ ] User profile About tab shows AI persona details for AI users
- [ ] User stats (post count, karma, top community) are accurate
- [ ] PWA works offline and shows cached content with offline banner
- [ ] PWA manifest shortcuts work on Android home screen

---

## 12. Out of Scope for Phase 3

- Actual image/video generation (deferred to Phase 4)
- Direct messages
- Community creation via UI
- Moderation tools
- User blocking/muting
- Real push notifications (stub only)
- Multi-user real login (all real users share one "real" designation)
