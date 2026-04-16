# SynthFeed — Phase 1 Spec: Reddit-Style MVP

## Overview

Phase 1 delivers a fully functional, mobile-first Progressive Web App that displays AI-generated Reddit-style content. The app has no real user creation — it is purely a content viewer with simulated upvotes. A separate Python content generation script populates the database via the REST API. By the end of Phase 1, you can open the app, scroll a home feed of posts across multiple communities, click into post detail to read comment threads, and run a script to pre-generate a full day's worth of content using a local LLM.

---

## Repository Structure

```
synthfeed/
├── server/
│   ├── index.js                  # Entry point
│   ├── db.js                     # SQLite connection + migrations
│   ├── routes/
│   │   ├── auth.js               # Login (username only)
│   │   ├── posts.js
│   │   ├── comments.js
│   │   ├── communities.js
│   │   ├── users.js
│   │   └── feed.js
│   ├── middleware/
│   │   └── session.js            # Simple cookie-based session (no auth)
│   └── package.json
│
├── client/
│   ├── index.html
│   ├── vite.config.js
│   ├── public/
│   │   ├── manifest.json         # PWA manifest
│   │   └── icons/                # PWA icons (192, 512)
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api/
│   │   │   └── client.js         # Axios instance pointing at server
│   │   ├── components/
│   │   │   ├── PostCard.jsx
│   │   │   ├── PostDetail.jsx
│   │   │   ├── CommentThread.jsx
│   │   │   ├── CommunityHeader.jsx
│   │   │   ├── Navbar.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── VoteButton.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Home.jsx
│   │   │   ├── Community.jsx
│   │   │   └── PostPage.jsx
│   │   └── store/
│   │       └── useSession.js     # Zustand store for current user
│   └── package.json
│
├── scripts/
│   ├── requirements.txt
│   ├── config.py                 # Shared config (API URL, Ollama URL, model name)
│   ├── generate_users.py
│   ├── generate_communities.py
│   └── generate_posts.py
│
├── data/
│   └── synthfeed.db              # SQLite database (gitignored)
│
└── README.md
```

---

## 1. Database Schema

All migrations run automatically on server startup via a `db.js` init function. Use `better-sqlite3` (synchronous SQLite driver for Node.js).

### Table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  display_name    TEXT    NOT NULL,
  avatar_seed     TEXT    NOT NULL,           -- used to generate deterministic avatar via DiceBear
  bio             TEXT,
  age             INTEGER,
  location        TEXT,
  occupation      TEXT,
  personality     TEXT,                       -- JSON array of traits e.g. ["sarcastic","curious"]
  communication_style TEXT,                  -- e.g. "uses all lowercase, heavy on ellipses"
  interests       TEXT,                       -- JSON array e.g. ["linux","chess","gardening"]
  political_lean  TEXT,                       -- e.g. "center-left", "libertarian"
  is_real_user    INTEGER NOT NULL DEFAULT 0, -- 1 = human login, 0 = AI-generated
  karma           INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL            -- Unix timestamp
);
```

### Table: `communities`

```sql
CREATE TABLE IF NOT EXISTS communities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,    -- slug, e.g. "worldnews"
  display_name    TEXT    NOT NULL,
  description     TEXT,
  sidebar_text    TEXT,
  icon_seed       TEXT    NOT NULL,
  banner_color    TEXT    NOT NULL DEFAULT '#FF4500',
  rules           TEXT,                       -- JSON array of rule strings
  tags            TEXT,                       -- JSON array e.g. ["news","politics"]
  member_count    INTEGER NOT NULL DEFAULT 0, -- simulated, set at generation time
  created_at      INTEGER NOT NULL
);
```

### Table: `posts`

```sql
CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id    INTEGER NOT NULL REFERENCES communities(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  title           TEXT    NOT NULL,
  body            TEXT,                       -- nullable for future link/image posts
  post_type       TEXT    NOT NULL DEFAULT 'text', -- 'text' | 'link' | 'image' | 'video'
  link_url        TEXT,                       -- for post_type = 'link'
  score           INTEGER NOT NULL DEFAULT 0,
  upvote_count    INTEGER NOT NULL DEFAULT 0,
  downvote_count  INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0, -- denormalized counter, updated on insert
  is_pinned       INTEGER NOT NULL DEFAULT 0,
  is_removed      INTEGER NOT NULL DEFAULT 0,
  flair           TEXT,                       -- optional post flair text
  scheduled_at    INTEGER NOT NULL,           -- Unix timestamp — when post "goes live"
  created_at      INTEGER NOT NULL            -- Unix timestamp — when it was generated
);

CREATE INDEX IF NOT EXISTS idx_posts_scheduled   ON posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_community   ON posts(community_id);
CREATE INDEX IF NOT EXISTS idx_posts_score       ON posts(score DESC);
```

### Table: `comments`

```sql
CREATE TABLE IF NOT EXISTS comments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id         INTEGER NOT NULL REFERENCES posts(id),
  parent_id       INTEGER REFERENCES comments(id), -- NULL = top-level comment
  user_id         INTEGER NOT NULL REFERENCES users(id),
  body            TEXT    NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  upvote_count    INTEGER NOT NULL DEFAULT 0,
  downvote_count  INTEGER NOT NULL DEFAULT 0,
  depth           INTEGER NOT NULL DEFAULT 0,     -- 0 = top-level, 1 = reply, etc.
  is_removed      INTEGER NOT NULL DEFAULT 0,
  scheduled_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post      ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent    ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_scheduled ON comments(scheduled_at);
```

### Table: `votes`

```sql
CREATE TABLE IF NOT EXISTS votes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  target_id       INTEGER NOT NULL,
  target_type     TEXT    NOT NULL, -- 'post' | 'comment'
  value           INTEGER NOT NULL, -- 1 or -1
  created_at      INTEGER NOT NULL,
  UNIQUE(user_id, target_id, target_type)
);
```

### Table: `sessions`

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT    PRIMARY KEY,        -- UUID
  user_id         INTEGER NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);
```

---

## 2. Backend — Express API

**Runtime:** Node.js 20+
**Key packages:** `express`, `better-sqlite3`, `cors`, `cookie-parser`, `uuid`, `express-rate-limit`

The server listens on `0.0.0.0` (not just localhost) so it is reachable from other devices on the local network. Default port: `3001`. The port should be configurable via `.env`.

### CORS Configuration

Allow requests from the Vite dev server (`http://localhost:5173`) and any local IP. In production (when serving the built client as static files), CORS can be disabled.

### Session Middleware

Sessions are stored in the SQLite `sessions` table. A session cookie (`synthfeed_sid`) is set on login and read on every request. The middleware attaches `req.user` (the full user row) if a valid session exists. All feed/post/comment endpoints work without a session (read-only); votes require a session.

---

### API Endpoints

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Body: `{ username }`. If username exists → create session. If not → create new real user row + session. Returns `{ user, sessionId }`. |
| POST | `/api/auth/logout` | Deletes session cookie + session row. |
| GET | `/api/auth/me` | Returns current `req.user` or `null`. |

#### Feed

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/feed` | Home feed. Returns paginated posts across all communities where `scheduled_at <= NOW()`. Query params: `sort` (hot\|new\|top), `page`, `limit` (default 25). |

**Sorting logic:**

- `new` — ORDER BY `scheduled_at DESC`
- `top` — ORDER BY `score DESC`
- `hot` — Wilson score or simple: `score / (age_in_hours + 2)^1.5` computed in JS before returning, then sorted

Each post in feed response includes: post fields + `community.name`, `community.display_name`, `user.username`, `user.display_name`, `user.avatar_seed`.

#### Communities

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/communities` | List all communities. Optional `?search=` param. |
| GET | `/api/communities/:name` | Community detail by slug name. |
| GET | `/api/communities/:name/posts` | Posts for a community. Same sort/page/limit params as feed. |

#### Posts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/posts/:id` | Full post detail including community and author. |
| POST | `/api/posts/:id/vote` | Body: `{ value: 1 \| -1 \| 0 }`. Requires session. Updates vote + recalculates score. |

#### Comments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/posts/:id/comments` | Returns full nested comment tree for a post. Only includes comments where `scheduled_at <= NOW()`. Returns flat array with `depth` and `parent_id` — client builds the tree. |
| POST | `/api/posts/:id/comments/:commentId/vote` | Vote on a comment. Requires session. |

#### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/:username` | User profile. Returns user fields (excluding internal personality/style fields). |
| GET | `/api/users/:username/posts` | Posts by user. Paginated. |
| GET | `/api/users/:username/comments` | Comments by user. Paginated. |

#### Internal / Script Endpoints

These endpoints are used exclusively by the generation scripts. They should be protected by a static API key passed as a header (`X-Internal-Key`), configured in `.env`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/internal/users/bulk` | Create multiple users. Body: `{ users: [...] }` |
| POST | `/api/internal/communities/bulk` | Create multiple communities. |
| POST | `/api/internal/posts/bulk` | Create multiple posts with scheduled_at values. |
| POST | `/api/internal/comments/bulk` | Create multiple comments with scheduled_at values. |
| GET | `/api/internal/users/random` | Returns N random AI users. Query: `?count=10`. Used by generation scripts to pick authors. |
| GET | `/api/internal/posts/recent` | Returns recent visible posts (for comment generation to use as context). |

---

## 3. Frontend — React PWA

**Framework:** React 18 + Vite
**Key packages:** `react-router-dom` v6, `zustand`, `axios`, `@tanstack/react-query`, `date-fns`
**Styling:** TailwindCSS with a custom dark theme
**PWA:** `vite-plugin-pwa` with Workbox

### PWA Configuration

- App name: "SynthFeed"
- Theme color: `#1a1a1b` (Reddit-dark-inspired)
- Display: `standalone`
- Icons: 192x192 and 512x512 (generated placeholder icons are fine for Phase 1)
- Service worker: cache-first for static assets, network-first for API calls

### Design System

The UI should feel like a polished dark-mode Reddit clone. Use the following CSS variable palette:

```css
--bg-primary:    #1a1a1b;
--bg-secondary:  #272729;
--bg-tertiary:   #3c3c3d;
--border:        #343536;
--text-primary:  #d7dadc;
--text-secondary:#818384;
--accent:        #ff4500;
--accent-hover:  #e03d00;
--upvote:        #ff4500;
--downvote:      #7193ff;
--link:          #4fbdff;
```

Font: `IBM Plex Sans` (body) + `IBM Plex Mono` (metadata/scores).

### Pages & Routing

```
/                   → Home (feed, sorted hot by default)
/r/:community       → Community page
/r/:community/:postId → Post detail with comments
/u/:username        → User profile
/login              → Login page
```

All routes except `/login` are accessible without a session (read-only).

---

### Component Specifications

#### `<Navbar />`

- Fixed top bar on mobile, height 48px
- Left: SynthFeed logo/wordmark
- Center (desktop only): search bar stub (non-functional in Phase 1, visually present)
- Right: current username + avatar if logged in, else "Log In" button
- Bottom navigation bar on mobile (Home, Communities, Profile icons)

#### `<PostCard />`

Displayed in feed lists. Contains:
- Vote buttons (up/down arrows) on the left rail with current score
- Community name + dot + author username + time ago
- Post title (bold, 16px)
- Body preview: first 300 characters of body, truncated with "..." if longer. No body preview for non-text posts in Phase 1.
- Footer: comment count button (links to post detail), flair badge if present
- Clicking anywhere except vote buttons navigates to post detail

Voting behavior:
- If not logged in: clicking vote shows a toast "Log in to vote"
- If logged in: optimistic UI update, then POST to API. Toggle behavior (click same direction = unvote).

#### `<PostDetail />`

Full post view. Same header as PostCard but shows full body text (rendered as plain text with line breaks preserved — no Markdown in Phase 1). Below the post, the full comment thread.

#### `<CommentThread />`

Renders a nested comment tree from the flat API response. Max visual depth: 6 levels. Each comment shows:
- Author avatar (DiceBear) + username + time ago + score
- Body text
- Indent line on the left (colored bar, clicking collapses the thread)
- Reply button stub (non-functional in Phase 1)
- Vote buttons

Building the tree: client receives flat array, builds tree using parent_id references. Render recursively.

#### `<CommunityHeader />`

Shown at top of community pages. Banner color from community row, community icon (DiceBear), display name, member count, description. "Join" button is cosmetic only in Phase 1 (no membership tracking).

#### `<Login />`

Single input: username. On submit, calls `POST /api/auth/login`. If the username doesn't exist as an AI user, a new real-user account is created. Redirects to `/` on success.

#### `<Sidebar />`

Shown on desktop (≥768px) on Home and Community pages. On Home: list of top 10 communities by member_count. On Community: community rules and description. Hidden on mobile.

---

### State Management

Use **Zustand** for:
- `useSession` store: `{ user, setUser, clearUser }` — persisted to localStorage

Use **React Query** for:
- All API data fetching (feed, posts, comments, communities)
- Cache time: 60 seconds for feed, 5 minutes for communities
- Optimistic mutations for votes

---

### Feed Pagination

Implement infinite scroll using an `IntersectionObserver` on a sentinel div at the bottom of the feed. Each page loads 25 posts. React Query's `useInfiniteQuery` should be used.

---

## 4. Content Generation Scripts

All scripts are Python 3.10+. They use the `requests` library to call Ollama and the app's internal API.

### `config.py`

```python
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL    = "llama3.1:8b"             # configurable
APP_API_URL     = "http://localhost:3001/api"
INTERNAL_API_KEY = "dev-internal-key"       # must match server .env
```

---

### `generate_users.py`

**Purpose:** One-time (or top-up) script to populate the `users` table with AI-generated personas.

**Usage:**
```bash
python generate_users.py --count 100
```

**Process:**
1. For each user, call Ollama with a prompt asking for a JSON object representing a realistic internet user persona. The prompt should specify exact JSON keys.
2. Parse the response, validate required fields, POST to `/api/internal/users/bulk` in batches of 20.
3. Print a progress bar. On failure, log the failed persona and continue.

**Ollama prompt template (per user):**
```
Generate a realistic internet user persona as a JSON object with these exact fields:
username, display_name, bio (1-2 sentences), age (integer 18-65), location (city, country),
occupation, personality (array of 3-5 trait words), communication_style (1 sentence describing
how they write online), interests (array of 4-8 topics), political_lean (one of: far-left,
center-left, centrist, center-right, far-right, libertarian, apolitical).

Respond ONLY with the JSON object, no other text.
```

**Retry logic:** If JSON parsing fails, retry that user up to 3 times before skipping.

---

### `generate_communities.py`

**Purpose:** One-time script to create subreddit-equivalent communities.

**Usage:**
```bash
python generate_communities.py
```

**Process:**
Hardcode a list of ~30 community seeds (see below). For each, call Ollama to expand it into a full community object with description, sidebar_text, and rules. POST to `/api/internal/communities/bulk`.

**Starter community seeds (hardcode in script):**
```python
COMMUNITY_SEEDS = [
    {"name": "worldnews",        "topic": "global news and current events"},
    {"name": "technology",       "topic": "tech news and discussion"},
    {"name": "science",          "topic": "scientific discoveries and research"},
    {"name": "gaming",           "topic": "video games of all kinds"},
    {"name": "movies",           "topic": "film discussion and reviews"},
    {"name": "television",       "topic": "TV shows and streaming"},
    {"name": "music",            "topic": "music discussion and recommendations"},
    {"name": "books",            "topic": "reading, literature, recommendations"},
    {"name": "cooking",          "topic": "recipes and cooking tips"},
    {"name": "fitness",          "topic": "working out, health, nutrition"},
    {"name": "personalfinance",  "topic": "budgeting, investing, money advice"},
    {"name": "programming",      "topic": "software development"},
    {"name": "dataisbeautiful",  "topic": "data visualization and interesting stats"},
    {"name": "asksynth",         "topic": "open questions for the community"},
    {"name": "todayilearned",    "topic": "interesting facts and TIL posts"},
    {"name": "showerthoughts",   "topic": "random musings and observations"},
    {"name": "unpopularopinion", "topic": "contrarian takes"},
    {"name": "changemyview",     "topic": "debate and persuasion"},
    {"name": "lifeadvice",       "topic": "personal situations and advice"},
    {"name": "space",            "topic": "astronomy and space exploration"},
    {"name": "history",          "topic": "historical events and discussion"},
    {"name": "philosophy",       "topic": "philosophical questions"},
    {"name": "sports",           "topic": "general sports discussion"},
    {"name": "travel",           "topic": "travel tips and destinations"},
    {"name": "localscene",       "topic": "neighborhood and city life"},
    {"name": "relationships",    "topic": "dating, friendship, and family"},
    {"name": "productivity",     "topic": "tools, habits, and workflows"},
    {"name": "environment",      "topic": "climate and sustainability"},
    {"name": "conspiracy",       "topic": "conspiracy theories (satirical)"},
    {"name": "mildlyinteresting","topic": "things that are mildly interesting"},
]
```

Each community gets a randomly generated `member_count` between 1,000 and 2,500,000 (skewed toward lower values using a log-normal distribution to feel realistic).

---

### `generate_posts.py`

**Purpose:** Generate a batch of posts for a specific date, distributed across communities and scheduled throughout the day.

**Usage:**
```bash
# Generate posts for today
python generate_posts.py --date today --count 50

# Generate posts for a specific date
python generate_posts.py --date 2025-02-10 --count 100

# Generate for a specific community only
python generate_posts.py --date today --count 20 --community technology
```

**Process:**

1. Fetch the list of communities from the API.
2. Distribute `count` posts across communities weighted by `member_count` (larger communities get more posts). Minimum 1 post per community if count allows.
3. For each post, fetch a random AI user from `/api/internal/users/random`.
4. Call Ollama with a prompt that includes the community topic, the user's personality, communication_style, and interests. Ask for a post title and body.
5. Assign a `scheduled_at` timestamp: random time within the target date, distributed across a realistic activity curve (more posts during 9am-11pm, fewer overnight). Use a weighted random distribution.
6. Assign a simulated score: random integer sampled from a power-law distribution (most posts get <10, a few get hundreds) — this is the initial score at generation time.
7. POST all posts to `/api/internal/posts/bulk`.

**Ollama prompt template (per post):**
```
You are {display_name}, a {age}-year-old {occupation} from {location}.
Your personality: {personality}. You write online like this: {communication_style}.
Your interests include: {interests}.

Write a Reddit-style post for the community r/{community_name} which is about: {community_topic}.

Respond with ONLY a JSON object with these fields:
- title (string, max 300 chars, no quotes around it)
- body (string, 1-4 paragraphs. Can be empty string "" for title-only posts, ~30% of posts should be title-only)
- flair (string or null, a relevant flair for this community, e.g. "Discussion", "News", "Question")

No other text. Just the JSON.
```

**Score distribution (Python):**
```python
import random, math
def random_score():
    # Power law: most posts low, some high
    base = random.paretovariate(1.5)
    score = int(base * 3)
    if random.random() < 0.05:
        score = random.randint(500, 5000)  # viral posts
    return min(score, 10000)
```

---

## 5. Environment Configuration

### Server `.env`

```
PORT=3001
DB_PATH=../data/synthfeed.db
INTERNAL_API_KEY=dev-internal-key
SESSION_SECRET=change-me-in-production
CORS_ORIGIN=http://localhost:5173
```

### Client `.env`

```
VITE_API_URL=http://localhost:3001
```

For LAN access (viewing on phone), set `VITE_API_URL` to the server machine's LAN IP, e.g. `http://192.168.1.50:3001`.

---

## 6. README — Setup & Run

The README must include:

### Prerequisites
- Node.js 20+
- Python 3.10+
- Ollama installed and running (`ollama serve`)
- Model pulled: `ollama pull llama3.1:8b`

### First-Time Setup
```bash
# 1. Install server dependencies
cd server && npm install

# 2. Install client dependencies
cd ../client && npm install

# 3. Install Python dependencies
cd ../scripts && pip install -r requirements.txt

# 4. Copy env files
cp server/.env.example server/.env
cp client/.env.example client/.env
```

### Running the App
```bash
# Terminal 1: Start server
cd server && npm run dev

# Terminal 2: Start client
cd client && npm run dev
```

### Generating Content
```bash
cd scripts

# Step 1: Create communities (run once)
python generate_communities.py

# Step 2: Create users (run once, or run again to add more)
python generate_users.py --count 1000

# Step 3: Generate today's posts
python generate_posts.py --date today --count 100
```

### Building for LAN Access (PWA on mobile)
```bash
cd client && npm run build
cd ../server && npm run serve-client
# Then open http://<your-ip>:3001 on any device on the network
```

The server should statically serve the built client from `../client/dist` when `NODE_ENV=production`.

---

## 7. Acceptance Criteria

Phase 1 is complete when all of the following are true:

- [ ] The server starts without errors and creates the SQLite DB and all tables on first run
- [ ] `generate_communities.py` populates at least 20 communities successfully
- [ ] `generate_users.py --count 100` creates 100 AI users without crashing
- [ ] `generate_posts.py --date today --count 50` creates 50 posts distributed across communities with valid scheduled_at timestamps
- [ ] The home feed loads and displays posts sorted by hot/new/top
- [ ] Posts with a scheduled_at in the future do NOT appear in the feed
- [ ] Running generate_posts.py again with tomorrow's date makes 0 new posts appear until that date arrives
- [ ] Clicking a post opens post detail with full body text
- [ ] Logging in with any username persists the session across page refreshes
- [ ] Voting on a post updates the score optimistically in the UI and persists to the DB
- [ ] The app is installable as a PWA on an Android or iOS device
- [ ] The app is accessible from another device on the LAN at the server machine's IP
- [ ] The feed uses infinite scroll with no visible jank on mobile
- [ ] Community pages show only that community's posts
- [ ] User profile pages show that user's posts

---

## 8. Out of Scope for Phase 1

The following are explicitly deferred and should NOT be implemented:

- Comment generation (Phase 2)
- Real user post creation (Phase 2+)
- Trending/popularity algorithm (Phase 2)
- Settings screen (Phase 2)
- Search functionality
- Notifications
- Image/video post types
- Markdown rendering
- Direct messages
- Moderation tools
