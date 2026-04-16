# SocialForge — Phase 2 Spec: Comments, Popularity & Settings

## Overview

Phase 2 builds on the Phase 1 MVP by adding three major pillars: (1) a full comment generation pipeline with realistic threaded conversations between AI users, (2) a simulated popularity and trending system that makes the feed feel alive and dynamic, and (3) a settings screen where the operator can tune all content generation parameters without editing code. By the end of Phase 2, the app feels like a real social media platform — the feed changes throughout the day, popular posts surface naturally, and comment sections have realistic multi-user discussions.

---

## 1. Comment Generation Pipeline

### New Script: `generate_comments.py`

**Purpose:** For each recent post, generate a realistic comment thread with multiple AI users replying to each other.

**Usage:**
```bash
# Generate comments for all posts created today
python generate_comments.py --date today

# Generate comments for a specific post
python generate_comments.py --post-id 42

# Generate comments for posts in a specific community
python generate_comments.py --date today --community technology

# Control depth and breadth
python generate_comments.py --date today --max-top-level 8 --max-depth 4 --max-replies 3
```

**Process:**

1. Fetch target posts from `/api/internal/posts/recent` (posts within the date range that have `scheduled_at <= NOW()` or scheduled for today).
2. For each post, determine a comment count using a power-law distribution (most posts get 0-5 comments, popular posts get many more). Use the post's score as a multiplier.
3. For each comment slot, fetch a random AI user (different from the post author, and varied across the thread — avoid the same user commenting twice unless replying).
4. Generate comments in tree order: generate top-level comments first, then generate replies that reference the parent comment's content.
5. Assign `scheduled_at` values that are always AFTER the post's `scheduled_at`, distributed with a realistic decay curve (most comments come in the first few hours, tapering off over 24 hours).
6. POST to `/api/internal/comments/bulk`.

**Comment count distribution:**
```python
def comment_count_for_post(post_score):
    if post_score < 5:
        return random.randint(0, 2)
    elif post_score < 50:
        return random.randint(2, 15)
    elif post_score < 500:
        return random.randint(10, 60)
    else:
        return random.randint(30, 200)
```

**Ollama prompt for top-level comment:**
```
You are {display_name}, a {age}-year-old {occupation} from {location}.
Personality: {personality}. You write online like this: {communication_style}.

You are commenting on this post in r/{community_name}:

TITLE: {post_title}
BODY: {post_body}

Write a single Reddit-style comment responding to this post. Your comment should reflect
your personality and communication style. It can be: an opinion, a question, a personal
anecdote, a correction, humor, or agreement/disagreement. Length: 1-4 sentences typically,
occasionally longer.

Respond with ONLY the comment text. No JSON, no quotes, no preamble.
```

**Ollama prompt for reply comment:**
```
You are {display_name}, a {age}-year-old {occupation} from {location}.
Personality: {personality}. You write online like this: {communication_style}.

You are replying to this comment in a thread about "{post_title}":

PARENT COMMENT (by {parent_author}): {parent_body}

Write a single reply. It could agree, disagree, ask a follow-up, add information, or be
humorous. Stay in character. 1-3 sentences.

Respond with ONLY the reply text.
```

**Score assignment for comments:** Same power-law distribution as posts, but with lower ceiling (max score ~500). Apply a small bonus to comments that are early in the thread.

---

### API Additions for Comments

#### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/posts/:id/comments` | Create a real user comment (Phase 2 — real user can now comment). Requires session. Body: `{ body, parent_id? }`. |

#### Updated Endpoint: `GET /api/posts/:id/comments`

Now accepts a `sort` param: `best` (default, by score) | `new` | `old` | `controversial` (high vote counts, low score).

Controversial sort formula: `(upvotes + downvotes) / abs(score + 1)`

---

### Real User Commenting (Phase 2 Feature)

The logged-in real user can now post comments. Requirements:

- "Add a comment" text area at the top of the comment section on PostDetail
- Reply button on each comment becomes functional — opens an inline reply box
- Character limit: 10,000
- On submit: POST to `/api/posts/:id/comments`
- Real user comments are immediately visible (scheduled_at = now)
- Real user's comments are visually differentiated (subtle highlight on the left border)

---

## 2. Popularity & Trending System

### Overview

The goal is to make the platform feel alive: posts that are doing well climb the hot sort, trending communities surface, and the front page changes throughout the day. This is achieved through a combination of: realistic initial score assignment, a score decay function over time, and a periodic "boost" job.

### Hot Score Algorithm

Phase 2 enhances the Phase 1 hot sort by tuning the decay constant based on observed content volume. The formula remains the same time-decay approach committed to in Phase 1:

```typescript
function hotScore(scheduledAt: number, score: number): number {
  const ageHours = (Date.now() / 1000 - scheduledAt) / 3600;
  return score / Math.pow(ageHours + 2, 1.5);
}
```

The decay exponent (`1.5`) can be made configurable via the new `hot_score_decay_hours` setting in Phase 2. This is computed at query time in TypeScript (not stored), applied after fetching the top N posts, then sorted. For performance, fetch the top 500 posts by `scheduled_at DESC` in the last 48 hours, compute hot scores, return top 25.

### Score Update Job

A new server-side background job runs every 15 minutes (using `setInterval` in `index.ts` or a lightweight job runner). It simulates ongoing voting activity on posts and comments that were recently published.

**Job: `jobs/scoreUpdater.ts`**

```typescript
// Every 15 minutes:
// 1. Fetch posts published in the last 6 hours
// 2. For each post, simulate N new votes based on post's current score and age
// 3. Apply votes: mostly upvotes (70%), some downvotes (30%), weighted by score
// 4. Update posts atomically: score = upvote_count - downvote_count in a single statement
// 5. Same for comments published in the last 3 hours
```

**Score invariant:** All score updates must atomically update `score`, `upvote_count`, and `downvote_count` together in a single SQL statement to ensure `score = upvote_count - downvote_count` is always true. Never update `score` alone.

The number of new votes per cycle should decrease as the post ages (exponential decay):
```typescript
function newVotesForAge(currentScore: number, ageHours: number): number {
  const baseActivity = Math.sqrt(currentScore + 1) * 3;
  const decay = Math.exp(-ageHours / 4);
  return Math.floor(baseActivity * decay * (0.5 + Math.random()));
}
```

This creates the sensation that fresh posts are gaining votes in real time.

### Trending Communities

New endpoint: `GET /api/communities/trending`

Returns top 5 communities by post activity in the last 24 hours. Query:
```sql
SELECT community_id, COUNT(*) as recent_posts, SUM(score) as total_score
FROM posts
WHERE scheduled_at > (strftime('%s','now') - 86400)
AND scheduled_at <= strftime('%s','now')
GROUP BY community_id
ORDER BY recent_posts DESC, total_score DESC
LIMIT 5
```

These are displayed in the Sidebar component.

---

## 3. Settings Screen

### Overview

A new `/settings` page accessible from the navbar. Settings are stored in a new `settings` table in SQLite and exposed via API. The generation scripts read from these settings at runtime (by calling the API) rather than hardcoding values.

### New Table: `settings`

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,      -- JSON-encoded value
  label TEXT NOT NULL,      -- Human-readable label for UI
  description TEXT,
  category TEXT NOT NULL,   -- grouping for UI
  type  TEXT NOT NULL       -- 'number' | 'boolean' | 'string' | 'select'
);
```

### Default Settings

Insert these rows on first migration:

| Key | Default | Label | Category | Type |
|-----|---------|-------|----------|------|
| `posts_per_day_min` | 50 | Min posts per day | Content Volume | number |
| `posts_per_day_max` | 150 | Max posts per day | Content Volume | number |
| `comments_per_post_multiplier` | 1.0 | Comment frequency multiplier | Content Volume | number |
| `max_comment_depth` | 4 | Max comment thread depth | Content Structure | number |
| `max_top_level_comments` | 12 | Max top-level comments per post | Content Structure | number |
| `max_replies_per_comment` | 3 | Max replies per comment | Content Structure | number |
| `title_only_post_ratio` | 0.3 | Ratio of title-only posts | Content Style | number |
| `hot_score_decay_hours` | 12 | Hot score half-life (hours) | Feed Algorithm | number |
| `score_update_interval_minutes` | 15 | Score update job interval | Feed Algorithm | number |
| `viral_post_probability` | 0.05 | Chance of a viral post | Feed Algorithm | number |
| `ollama_model` | gemma4:e2b | Ollama model name | Generation | string |
| `ollama_temperature` | 0.8 | LLM temperature | Generation | number |
| `default_post_sort` | hot | Default feed sort | Display | select |
| `posts_per_page` | 25 | Posts per page | Display | number |
| `show_user_karma` | true | Show karma scores | Display | boolean |
| `community_post_weight_by_size` | true | Weight post distribution by community size | Generation | boolean |
| `generation_timezone` | America/New_York | Timezone for post scheduling | Generation | string |
| `activity_peak_hours` | [9,22] | Active hour range (start, end) | Generation | string |

### Settings API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Returns all settings as `{ key: value }` flat object |
| GET | `/api/settings/:key` | Single setting value |
| PUT | `/api/settings/:key` | Update a setting. Body: `{ value }`. Validates type. |
| PUT | `/api/settings` | Bulk update settings. Body: `{ settings: { key: value, ... } }` |
| GET | `/api/settings/schema` | Returns full schema (all rows including label, description, type, category) for building the UI. Note: register this route *before* `/api/settings/:key` to avoid the `:key` parameter capturing "schema". |

### Settings Page UI

The `/settings` page is only accessible when logged in as a real user. It renders the settings grouped by category, using the schema from `/api/settings/schema`.

Layout:
- Left: category navigation list (sticky on desktop)
- Right: form fields for the selected category
- Each field rendered appropriately by type: number input, toggle switch, text input, dropdown
- Auto-save on blur (no submit button needed — PUT on change with 500ms debounce)
- Toast notification on save: "Settings updated"
- A "Reset to defaults" button per category

---

## 4. Database Additions

### Schema Changes

Add to `posts` table:
```sql
ALTER TABLE posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
```

Add to `users` table:
```sql
ALTER TABLE users ADD COLUMN post_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;
```

Both are denormalized counters updated on insert. They allow profile pages to display stats without expensive COUNT queries.

### New Table: `jobs_log`

```sql
CREATE TABLE IF NOT EXISTS jobs_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name    TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT    NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'error'
  message     TEXT
);
```

The score updater job writes a row to this table on each run. This is viewable in the Settings screen under a "System" category as a simple log table.

---

## 5. Frontend Additions

### Comment Section (PostDetail)

The `<CommentThread />` component is significantly enhanced:

**Sort bar:** Tabs above comments: Best | New | Old | Controversial

**Comment rendering:**
- Collapse/expand threads by clicking the vertical indent line (already in Phase 1 spec, now fully implemented)
- "Load more replies" button if a comment has more than `max_replies_per_comment` children
- Show "X more comments" at the bottom if total visible < total comment_count
- Each comment shows: avatar, username (links to /u/:username), time ago, score, vote buttons
- Inline reply box (shown on "Reply" click): textarea + Submit/Cancel buttons. Only for logged-in real users.

**Empty state:** If no comments yet (but post exists), show "No comments yet. Be the first."

### Sidebar Enhancements

- "Trending Today" section showing the 5 trending communities with a small post count badge
- "Top Posts This Week" list: 3 posts with title and score

### User Profile Enhancements

The `/u/:username` page now shows:
- Post count + comment count + karma (if `show_user_karma` setting is true)
- Tabs: Posts | Comments
- Post tab: same PostCard layout
- Comment tab: compact view — community name + post title (linked) + comment body excerpt + score

### NavBar Enhancements

- Settings icon in navbar (gear icon), visible only to logged-in real user
- On mobile bottom nav, Settings replaces one of the less-used icons

---

## 6. Generation Script Enhancements

### All Scripts: Read Settings from API

At the start of each script, fetch current settings:
```python
def load_settings():
    resp = requests.get(f"{APP_API_URL}/settings", headers=INTERNAL_HEADERS)
    return resp.json()
```

Replace all hardcoded values in scripts with values from `settings`.

### `generate_posts.py` Enhancements

- Use `posts_per_day_min` / `posts_per_day_max` from settings for default count when `--count` not specified
- Use `activity_peak_hours` and `generation_timezone` for `scheduled_at` distribution
- Use `viral_post_probability` for score distribution
- Use `title_only_post_ratio` for body generation
- Use `ollama_temperature` in all Ollama calls
- Use `ollama_model` instead of hardcoded model name

### `generate_comments.py` Enhancements

- Use `max_comment_depth`, `max_top_level_comments`, `max_replies_per_comment` from settings
- Use `comments_per_post_multiplier` to scale comment counts

### New Script: `generate_daily.py`

A convenience wrapper that runs a full day's generation in sequence:
```bash
python generate_daily.py --date today
# equivalent to:
# python generate_posts.py --date today
# python generate_comments.py --date today
```

Useful for cron job or scheduler integration.

---

## 7. Acceptance Criteria

Phase 2 is complete when:

- [ ] `generate_comments.py` runs successfully and creates nested comment threads for posts
- [ ] Comment threads render correctly nested up to 4 levels deep in the UI
- [ ] Thread collapse/expand works by clicking indent lines
- [ ] A logged-in real user can post top-level comments and replies
- [ ] Comments have sort options (Best/New/Old/Controversial) that re-order the thread
- [ ] Hot sort on the home feed changes meaningfully throughout the day as scores update
- [ ] The score updater background job runs every 15 minutes and updates scores
- [ ] Trending communities appear in the sidebar and change based on recent activity
- [ ] The `/settings` page is accessible and all settings render with correct input types
- [ ] Changing a setting in the UI persists to the DB and is reflected in the next script run
- [ ] `generate_daily.py` runs end-to-end without manual intervention
- [ ] All generation scripts read from the settings API instead of hardcoded values
- [ ] User profile pages show post count, comment count, and karma
- [ ] Comment tab on user profile shows recent comments with correct context

---

## 8. Out of Scope for Phase 2

- Image/video post types
- Real user post creation
- Search functionality
- Notifications
- Markdown rendering
- Direct messages
- Community creation UI
- User management (blocking, reporting)
