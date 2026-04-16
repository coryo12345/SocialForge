# SocialForge — Phase 1 Spec: Reddit-Style MVP

## Overview

Phase 1 delivers a fully functional, mobile-first Progressive Web App that displays AI-generated Reddit-style content. The app has no real user creation — it is purely a content viewer with simulated upvotes. A separate Python content generation script populates the database via the REST API. By the end of Phase 1, you can open the app, scroll a home feed of posts across multiple communities, click into post detail to read comment threads, and run a script to pre-generate a full day's worth of content using a local LLM.

---

## Repository Structure

```
SocialForge/
├── server/
│   ├── index.ts                  # Entry point
│   ├── db.ts                     # SQLite connection + migrations
│   ├── routes/
│   │   ├── auth.ts               # Login (username only)
│   │   ├── posts.ts
│   │   ├── comments.ts
│   │   ├── communities.ts
│   │   ├── users.ts
│   │   └── feed.ts
│   ├── middleware/
│   │   └── session.ts            # Simple cookie-based session (no auth)
│   ├── jobs/                     # Background jobs (Phase 2+, created empty in Phase 1)
│   ├── tsconfig.json
│   └── package.json
│
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   ├── public/
│   │   ├── manifest.json         # PWA manifest
│   │   └── icons/                # PWA icons (192, 512)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── styles/
│   │   │   └── globals.css       # Tailwind v4 @import + Forge theme variables
│   │   ├── api/
│   │   │   └── client.ts         # Axios instance pointing at server
│   │   ├── components/
│   │   │   ├── PostCard.tsx
│   │   │   ├── PostDetail.tsx
│   │   │   ├── CommentThread.tsx
│   │   │   ├── CommunityHeader.tsx
│   │   │   ├── Navbar.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── VoteButton.tsx
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── Community.tsx
│   │   │   └── PostPage.tsx
│   │   └── store/
│   │       └── useSession.ts     # Zustand store for current user + theme
│   ├── tsconfig.json
│   └── package.json
│
├── shared/
│   └── types.ts                  # Shared TypeScript types: DB row shapes, API response shapes
│
├── scripts/
│   ├── requirements.txt
│   ├── config.py                 # Shared config (reads from env vars with fallbacks)
│   ├── generate_users.py
│   ├── generate_communities.py
│   └── generate_posts.py
│
├── data/
│   └── SocialForge.db            # SQLite database (gitignored)
│
└── README.md
```

### Shared Types (`shared/types.ts`)

Define TypeScript interfaces for all DB row types and API response shapes here. Both the server and client import from this file to prevent type drift between what the API returns and what the client expects.

```typescript
// Example — expand to cover all tables and response envelopes
export interface User {
  id: number;
  username: string;
  display_name: string;
  avatar_seed: string;
  bio: string | null;
  is_real_user: 0 | 1;
  karma: number;
  created_at: number;
}

export interface Post {
  id: number;
  community_id: number;
  user_id: number;
  title: string;
  body: string | null;
  post_type: 'text' | 'link' | 'image' | 'video';
  score: number;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  flair: string | null;
  scheduled_at: number;
  created_at: number;
  updated_at: number;
}

export interface FeedPost extends Post {
  community_name: string;
  community_display_name: string;
  community_banner_color: string;
  author_username: string;
  author_display_name: string;
  author_avatar_seed: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}
```

---

## 1. Database Schema

All migrations run automatically on server startup via a `db.ts` init function. Use `better-sqlite3` (synchronous SQLite driver for Node.js).

### Table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT    NOT NULL UNIQUE,
  display_name         TEXT    NOT NULL,
  avatar_seed          TEXT    NOT NULL,       -- random 8-char hex string, e.g. "a3f8c1d2"
  bio                  TEXT,
  age                  INTEGER,
  location             TEXT,
  occupation           TEXT,
  personality          TEXT,                   -- JSON-encoded array of traits e.g. ["sarcastic","curious"]
  communication_style  TEXT,                   -- e.g. "uses all lowercase, heavy on ellipses"
  interests            TEXT,                   -- JSON-encoded array e.g. ["linux","chess","gardening"]
  political_lean       TEXT,                   -- e.g. "center-left", "libertarian"
  is_real_user         INTEGER NOT NULL DEFAULT 0, -- 1 = human login, 0 = AI-generated
  karma                INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL        -- Unix timestamp
);
```

**Note on JSON columns:** `personality`, `interests` are stored as JSON-encoded text strings. Always `JSON.parse()` on read and `JSON.stringify()` on write in `db.ts`.

**Note on `avatar_seed`:** A random 8-character hex string generated at user creation time (never sourced from Ollama). Used to construct a deterministic DiceBear avatar URL client-side.

### Table: `communities`

```sql
CREATE TABLE IF NOT EXISTS communities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,     -- URL slug, e.g. "worldnews"
  display_name    TEXT    NOT NULL,
  description     TEXT,
  sidebar_text    TEXT,
  icon_seed       TEXT    NOT NULL,            -- random 8-char hex string (same pattern as avatar_seed)
  banner_color    TEXT    NOT NULL DEFAULT '#c4730a', -- Forge amber default
  rules           TEXT,                        -- JSON-encoded array of rule strings
  tags            TEXT,                        -- JSON-encoded array e.g. ["news","politics"]
  member_count    INTEGER NOT NULL DEFAULT 0,  -- simulated, set at generation time
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
  body            TEXT,                        -- NULL or empty string for title-only posts
  post_type       TEXT    NOT NULL DEFAULT 'text'
                    CHECK (post_type IN ('text','link','image','video')),
  link_url        TEXT,                        -- for post_type = 'link'
  score           INTEGER NOT NULL DEFAULT 0,  -- denormalized: always = upvote_count - downvote_count
  upvote_count    INTEGER NOT NULL DEFAULT 0,
  downvote_count  INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,  -- denormalized; updated when comments inserted (Phase 2+)
  is_pinned       INTEGER NOT NULL DEFAULT 0,
  is_removed      INTEGER NOT NULL DEFAULT 0,
  removed_at      INTEGER,                     -- Unix timestamp when removed, NULL if not removed
  flair           TEXT,
  scheduled_at    INTEGER NOT NULL,            -- Unix timestamp — when post becomes visible
  created_at      INTEGER NOT NULL,            -- Unix timestamp — when row was inserted
  updated_at      INTEGER NOT NULL             -- Unix timestamp — last modification (= created_at initially)
);

CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id);
CREATE INDEX IF NOT EXISTS idx_posts_score     ON posts(score DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user      ON posts(user_id);
```

**Important — `score` invariant:** `score` is always equal to `upvote_count - downvote_count`. It is kept as a denormalized column for sort performance. Every vote mutation must update all three columns atomically in a single SQL statement to prevent drift:

```sql
UPDATE posts
SET upvote_count = upvote_count + ?,
    downvote_count = downvote_count + ?,
    score = score + ? - ?
WHERE id = ?
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
  depth           INTEGER NOT NULL DEFAULT 0,      -- 0 = top-level, 1 = reply, etc.
  is_removed      INTEGER NOT NULL DEFAULT 0,
  removed_at      INTEGER,
  scheduled_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post      ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent    ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_scheduled ON comments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_comments_user      ON comments(user_id);
```

### Table: `votes`

```sql
CREATE TABLE IF NOT EXISTS votes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  target_id       INTEGER NOT NULL,
  target_type     TEXT    NOT NULL CHECK (target_type IN ('post','comment')),
  value           INTEGER NOT NULL CHECK (value IN (-1, 0, 1)),
  created_at      INTEGER NOT NULL,
  UNIQUE(user_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_id, target_type);
```

### Table: `sessions`

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT    PRIMARY KEY,         -- UUID v4
  user_id         INTEGER NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL             -- Unix timestamp; rolling 30-day expiry
);
```

**Session lifecycle:** On every authenticated request the middleware updates `last_seen_at` and extends `expires_at` by 30 days (rolling window). On server startup, delete all rows where `expires_at < NOW()`.

---

## 2. Backend — Express API

**Runtime:** Node.js 24+
**Language:** TypeScript, compiled via `tsx` in development and `tsc` for production builds.
**Key packages:** `express@^5`, `better-sqlite3@^11`, `cors`, `cookie-parser`, `uuid`, `express-rate-limit`
**TypeScript packages:** `typescript`, `tsx`, `@types/node`, `@types/express`, `@types/better-sqlite3`, `@types/cookie-parser`, `@types/cors`, `@types/uuid`

The server listens on `0.0.0.0` (not just localhost) so it is reachable from other devices on the local network. Default port: `3001`, configurable via `.env`.

### Express v5 Notes

Express 5 is stable (released September 2024). Key differences from v4 relevant to this project:

- Async route handlers automatically propagate thrown errors to Express's error middleware — no need for `try/catch` wrappers in route handlers or the `express-async-errors` library.
- Path routing is stricter — avoid implicit regex in route strings; use explicit regex or named parameters.
- `res.sendFile()` requires absolute paths.

### CORS Configuration

The `CORS_ORIGIN` env var is a comma-separated list of allowed origins. The CORS middleware should split on `,` and validate requests against the resulting array. Example: `CORS_ORIGIN=http://localhost:5173,http://192.168.1.50:5173`. In production (serving the built client as static files from the same Express origin), CORS can be disabled entirely.

### Session Middleware

Sessions are stored in the SQLite `sessions` table. A session cookie named `sf_sid` (HttpOnly, SameSite=Lax) is set on login and read on every request. The middleware attaches `req.user` (the full user row) if a valid, non-expired session exists. All feed/post/comment GET endpoints work without a session; votes require a session.

### Rate Limiting

Apply `express-rate-limit` as follows:

```typescript
// General limiter applied to all /api/* routes
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120 });

// Stricter limiter applied only to vote endpoints
const voteLimiter = rateLimit({ windowMs: 60_000, max: 30 });
```

Internal endpoints (protected by `X-Internal-Key`) are exempt from rate limiting.

### DiceBear Avatars

- **Version:** DiceBear v9. URL format: `https://api.dicebear.com/9.x/{style}/svg?seed={seed}`
- **User avatars:** style `lorelei`. Example: `https://api.dicebear.com/9.x/lorelei/svg?seed=a3f8c1d2`
- **Community icons:** style `shapes`. Example: `https://api.dicebear.com/9.x/shapes/svg?seed=b7e2a091`
- Avatar and icon URLs are **constructed client-side** from the stored seed string. Seeds are never changed after creation.

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
| GET | `/api/feed` | Home feed. Returns cursor-paginated posts where `scheduled_at <= NOW()`. Query params: `sort` (hot\|new\|top), `cursor`, `limit` (default 25, max 50). |

**Sorting logic:**

- `new` — `ORDER BY scheduled_at DESC`. Cursor = last item's `scheduled_at`.
- `top` — `ORDER BY score DESC, id DESC`. Cursor = composite of last item's `score` and `id`.
- `hot` — Fetch the 500 most recent posts by `scheduled_at DESC` (last 48 hours), compute hot score in TypeScript, sort, return page. Cursor = opaque string encoding position.

**Hot score formula (committed — no alternatives):**
```typescript
function hotScore(scheduledAt: number, score: number): number {
  const ageHours = (Date.now() / 1000 - scheduledAt) / 3600;
  return score / Math.pow(ageHours + 2, 1.5);
}
```

**Cursor-based pagination:** The response includes `{ items: Post[], nextCursor: string | null }`. Pass `?cursor=<value>` on subsequent requests. This prevents duplicate or skipped posts as new content arrives during an infinite-scroll session. React Query's `useInfiniteQuery` uses `nextCursor` as `pageParam`.

Each post in the feed response includes: all post fields + `community_name`, `community_display_name`, `community_banner_color`, `author_username`, `author_display_name`, `author_avatar_seed`.

#### Communities

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/communities` | List all communities, ordered by `member_count DESC`. Optional `?search=` param (filters by name/display_name). |
| GET | `/api/communities/:name` | Community detail by slug name. |
| GET | `/api/communities/:name/posts` | Posts for a community. Same sort/cursor/limit params as feed. |

#### Posts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/posts/:id` | Full post detail including community and author fields. |
| POST | `/api/posts/:id/vote` | Body: `{ value: 1 \| -1 \| 0 }` (0 = remove vote). Requires session. Atomically updates vote row + score/upvote_count/downvote_count on the post. |

#### Comments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/posts/:id/comments` | Returns full comment tree for a post as a flat array. Only includes comments where `scheduled_at <= NOW()`. Client builds the tree from `depth` and `parent_id`. |
| POST | `/api/posts/:id/comments/:commentId/vote` | Vote on a comment. Requires session. Same value semantics as post voting. |

#### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/:username` | User profile. Returns user fields excluding `personality`, `communication_style`, `interests`, `political_lean` (these are surfaced in Phase 3's profile enhancement). |
| GET | `/api/users/:username/posts` | Posts by user. Cursor-paginated. |
| GET | `/api/users/:username/comments` | Comments by user. Cursor-paginated. |

#### Internal / Script Endpoints

Protected by `X-Internal-Key` header matching `INTERNAL_API_KEY` in `.env`. No rate limiting. These are used exclusively by generation scripts.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/internal/users/bulk` | Create multiple users. Body: `{ users: [...] }` |
| POST | `/api/internal/communities/bulk` | Create multiple communities. |
| POST | `/api/internal/posts/bulk` | Create multiple posts with `scheduled_at` values. |
| POST | `/api/internal/comments/bulk` | Create multiple comments. Also increments `posts.comment_count` for each affected post in the same transaction. |
| GET | `/api/internal/users/random` | Returns N random AI users. Query: `?count=10`. |
| GET | `/api/internal/posts/recent` | Returns recent visible posts (for Phase 2 comment generation). |

---

## 3. Frontend — React PWA

**Framework:** React 19 + Vite 6
**Key packages:** `react-router-dom@^7` (library mode), `zustand@^5`, `axios@^1`, `@tanstack/react-query@^5`, `date-fns@^4`
**Styling:** TailwindCSS v4 with Forge theme (light + dark modes)
**PWA:** `vite-plugin-pwa` with Workbox
**Fonts:** `@fontsource-variable/inter` (body), `@fontsource/jetbrains-mono` (scores/metadata)

### Framework Version Notes

**React Router v7 (library mode):** Use `createBrowserRouter` and `RouterProvider` in `main.tsx`. The route definition and `<Link>` API are effectively the same as v6. Do not use framework mode.

**React Query v5:** `status === 'loading'` is now `status === 'pending'`; the `isPending` shorthand replaces `isLoading`. `useInfiniteQuery` requires an explicit `initialPageParam` option. `onSuccess`/`onError` query callbacks are removed — use `useEffect` to react to query state changes if needed.

**React 19:** `ref` is now a regular prop on function components — no `forwardRef` needed for new components.

### PWA Configuration

- App name: "SocialForge" / short name: "Forge"
- Theme color: `#0d1117` (dark mode default; update via `<meta name="theme-color">` dynamically if light mode is active)
- Display: `standalone`
- Icons: 192×192 and 512×512 (generated placeholder icons acceptable for Phase 1)
- Service worker: cache-first for static assets, network-first for API calls

---

### Design System — Forge Theme

The UI should feel like a polished, distinct social platform — not a Reddit clone. The **Forge theme** uses warm amber as the brand accent (the "forge fire"), slate-blue backgrounds in dark mode, and warm parchment tones in light mode. Both light and dark modes are first-class; neither is an afterthought.

#### Theme Switching

- Stored in `useSession` Zustand store as `theme: 'light' | 'dark' | 'system'`, persisted to localStorage.
- On mount, apply the resolved theme class (`light` or `dark`) to `<html>`.
- Default: `'system'` — resolved via `window.matchMedia('(prefers-color-scheme: dark)')`.
- A toggle icon (sun/moon) in the Navbar cycles between modes.

#### Tailwind v4 Configuration (`src/styles/globals.css`)

```css
@import "tailwindcss";
@import "@fontsource-variable/inter";
@import "@fontsource/jetbrains-mono";

/* Map Tailwind color tokens to CSS custom properties for runtime theme switching */
@theme inline {
  --color-bg-primary:     var(--bg-primary);
  --color-bg-secondary:   var(--bg-secondary);
  --color-bg-tertiary:    var(--bg-tertiary);
  --color-border:         var(--border-color);
  --color-text-primary:   var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-accent:         var(--accent);
  --color-accent-hover:   var(--accent-hover);
  --color-upvote:         var(--upvote);
  --color-downvote:       var(--downvote);
  --color-link:           var(--link);
  --color-tag-bg:         var(--tag-bg);

  --font-sans: "Inter Variable", sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}

/* Light mode (default) */
:root {
  --bg-primary:     #f7f4ef;   /* warm parchment */
  --bg-secondary:   #ffffff;
  --bg-tertiary:    #ede9e2;   /* slightly warm card surface */
  --border-color:   #d6cfc4;
  --text-primary:   #1a1e2a;   /* near-black with blue tint */
  --text-secondary: #6b6760;   /* warm gray */
  --accent:         #c4730a;   /* deep amber — readable on light bg */
  --accent-hover:   #a85f06;
  --upvote:         #c4730a;
  --downvote:       #4a6db5;
  --link:           #1d6bbf;
  --tag-bg:         #e8f0f8;
}

/* Dark mode */
.dark {
  --bg-primary:     #0d1117;   /* deep charcoal — like cooled steel */
  --bg-secondary:   #161b27;   /* midnight slate */
  --bg-tertiary:    #1e2535;   /* card surface */
  --border-color:   #2a3040;
  --text-primary:   #e2e8f0;   /* cool off-white */
  --text-secondary: #7c879a;   /* muted slate */
  --accent:         #f09d2e;   /* ember amber */
  --accent-hover:   #d4860f;
  --upvote:         #f09d2e;
  --downvote:       #7b9cdd;   /* steel blue */
  --link:           #60aff5;
  --tag-bg:         #1e2d40;
}
```

**Usage in components:** Use Tailwind utility classes derived from the token names, e.g. `bg-bg-primary`, `text-text-primary`, `text-accent`, `border-border`, `text-upvote`, `font-mono` (scores/metadata), `font-sans` (body).

---

### Pages & Routing

```
/                     → Home (feed, sorted hot by default)
/r/:community         → Community page
/r/:community/:postId → Post detail with comments
/u/:username          → User profile
/login                → Login page
```

All routes except `/login` are accessible without a session (read-only).

---

### Component Specifications

#### `<Navbar />`

- Fixed top bar, height 48px
- Left: SocialForge logo/wordmark (links to `/`)
- Center (desktop only): search bar stub — non-functional in Phase 1, visually present
- Right: avatar + username if logged in, else "Log In" button; dark/light mode toggle (sun/moon icon)
- Mobile bottom navigation bar: Home, Communities, Profile icons

#### `<PostCard />`

Displayed in feed lists. Contains:
- Vote buttons (up/down arrows) on the left rail with current score displayed in `font-mono`
- Community name + dot + author username + time ago (via `date-fns`)
- Post title (bold, 16px)
- Body preview: first 300 characters, truncated with "…" if longer. No preview for non-text posts or posts with empty/null body.
- Footer: comment count button (links to post detail), flair badge if present
- Clicking anywhere except vote buttons navigates to post detail

Voting behavior:
- Not logged in: clicking vote shows a toast "Log in to vote"
- Logged in: optimistic UI update → POST to API. Clicking the same direction again removes the vote (`value: 0`).

#### `<PostDetail />`

Full post view. Same header as PostCard. Full body text rendered as plain text with line breaks preserved (no Markdown in Phase 1). Below the post: full comment thread.

#### `<CommentThread />`

Renders a nested comment tree from the flat API response. Max visual depth: 6 levels. Each comment shows:
- Author avatar (DiceBear `lorelei`) + username + time ago + score in `font-mono`
- Body text
- Left indent bar colored with `--accent`; clicking it collapses/expands that thread branch
- Reply button stub (non-functional in Phase 1)
- Vote buttons

**Tree building:** Receive flat array from API, build tree client-side using `parent_id` references. Render recursively. Sort children by `score DESC` at each level.

#### `<CommunityHeader />`

Shown at top of community pages. Banner uses `community.banner_color` as background. Community icon (DiceBear `shapes`), display name, member count (formatted with locale separators), description. "Join" button is cosmetic only in Phase 1.

#### `<Login />`

Single text input: username. On submit, POST to `/api/auth/login`. Creates a new real-user account if username not found. Redirects to `/` on success.

#### `<Sidebar />`

Desktop only (≥768px). On Home: top 10 communities by `member_count`. On Community: community rules and description.

---

### State Management

**Zustand** (`useSession`):
```typescript
interface SessionStore {
  user: User | null;
  theme: 'light' | 'dark' | 'system';
  setUser: (user: User | null) => void;
  clearUser: () => void;
  toggleTheme: () => void;
}
```
Persisted to localStorage.

**React Query v5:**
- All API data fetching (feed, posts, comments, communities)
- `gcTime` (formerly `cacheTime`): 60 seconds for feed, 5 minutes for communities
- Optimistic mutations for votes
- Note: use `isPending` not `isLoading`; `useInfiniteQuery` requires `initialPageParam: null`

---

### Feed Pagination

Infinite scroll using `IntersectionObserver` on a sentinel div at the bottom of the feed. Each page loads 25 posts. Use `useInfiniteQuery` with cursor-based pagination:

```typescript
const { data, fetchNextPage, hasNextPage, isPending } = useInfiniteQuery({
  queryKey: ['feed', sort],
  queryFn: ({ pageParam }) =>
    apiClient.get<PaginatedResponse<FeedPost>>('/feed', {
      params: { sort, cursor: pageParam, limit: 25 },
    }).then(r => r.data),
  initialPageParam: null as string | null,
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});
```

---

## 4. Content Generation Scripts

All scripts are Python 3.10+. They use the `requests` library to call Ollama and the app's internal API.

### `config.py`

```python
import os

OLLAMA_BASE_URL  = os.getenv("OLLAMA_URL",       "http://localhost:11434")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL",     "llama3.1:8b")
APP_API_URL      = os.getenv("APP_API_URL",      "http://localhost:3001/api")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "dev-internal-key")  # must match server .env

INTERNAL_HEADERS = {"X-Internal-Key": INTERNAL_API_KEY}
```

Override any value by setting the corresponding environment variable before running a script.

---

### `generate_users.py`

**Purpose:** One-time (or top-up) script to populate the `users` table with AI-generated personas.

**Usage:**
```bash
python generate_users.py --count 100
```

**Process:**
1. For each user, call Ollama with a prompt asking for a JSON persona object.
2. Parse the response, validate required fields. Generate `avatar_seed` as a random 8-character hex string (`secrets.token_hex(4)`).
3. POST to `/api/internal/users/bulk` in batches of 20.
4. Print a progress bar. On failure, log and continue.

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
Use the hardcoded seed list below. For each seed, call Ollama to expand it into a full community object with `description`, `display_name`, `sidebar_text`, and `rules`. Generate `icon_seed` as `secrets.token_hex(4)`. POST to `/api/internal/communities/bulk`.

**Community seeds:**
```python
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
    {"name": "pettyrevenge",       "topic": "small, creative, and deeply satisfying acts of revenge against people who were rude, inconsiderate, or mildly deserving of comeuppance"},
    {"name": "nuclearrevenge",     "topic": "extreme, scorched-earth revenge stories where someone went way further than necessary — and it was absolutely worth it"},
    {"name": "maliciouscompliance","topic": "following instructions or rules to the exact letter in a way that technically satisfies the request while spectacularly defeating its purpose"},
    {"name": "amioverreacting",    "topic": "sharing an emotional reaction to a situation and asking whether your response was proportionate — sometimes the answer is yes, sometimes no"},
    {"name": "bridezillas",        "topic": "wedding horror stories — out-of-control brides, grooms, and wedding parties who turned a celebration into a nightmare of entitlement and drama"},
    {"name": "rpghorrorstories",   "topic": "tabletop RPG nightmare experiences — problem players, power-tripping GMs, disruptive characters, rules lawyering, and campaigns that imploded spectacularly"},
    {"name": "idontworkherelady",  "topic": "stories of being mistaken for an employee somewhere — and the absurd, entitled, or hilarious interactions that followed when you either helped or didn't"},
    {"name": "entitledpeople",     "topic": "stories about people who behave as if the world owes them everything — Karens, entitled parents, boundary-stompers, and those who make everyone else's day worse"},

    # Meta
    {"name": "conspiracy",         "topic": "conspiracy theories, alternative explanations for historical events, and hidden connections — from satirical tongue-in-cheek to earnestly argued rabbit holes"},
]
```

Each community gets a randomly generated `member_count` between 1,000 and 2,500,000 using a log-normal distribution skewed toward lower values.

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
2. Distribute `count` posts across communities weighted by `member_count`. Minimum 1 post per community if count allows.
3. For each post, fetch a random AI user from `/api/internal/users/random`.
4. Call Ollama with a prompt including the community topic, user's personality, communication_style, and interests.
5. Assign `scheduled_at`: random time within the target date, weighted toward a realistic activity curve (more posts 9am–11pm, fewer overnight).
6. Assign a simulated `score` via power-law distribution.
7. Set `created_at = updated_at = int(time.time())`. Set `scheduled_at` per step 5.
8. POST all posts to `/api/internal/posts/bulk`.

**Ollama prompt template (per post):**
```
You are {display_name}, a {age}-year-old {occupation} from {location}.
Your personality: {personality}. You write online like this: {communication_style}.
Your interests include: {interests}.

Write a Reddit-style post for the community r/{community_name} which is about: {community_topic}.

Respond with ONLY a JSON object with these fields:
- title (string, max 300 chars)
- body (string, 1-4 paragraphs. Use empty string "" for title-only posts; ~30% of posts should be title-only)
- flair (string or null, a relevant flair for this community, e.g. "Discussion", "News", "Question")

No other text. Just the JSON.
```

**Score distribution:**
```python
import random

def random_score() -> int:
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
NODE_ENV=development
DB_PATH=../data/SocialForge.db
INTERNAL_API_KEY=dev-internal-key
SESSION_SECRET=change-me-in-production
CORS_ORIGIN=http://localhost:5173
```

### Client `.env`

```
VITE_API_URL=http://localhost:3001
```

For LAN access (viewing on phone), set `VITE_API_URL` to the server's LAN IP (e.g. `http://192.168.1.50:3001`) and add that origin to `CORS_ORIGIN` on the server as a comma-separated second value.

---

## 6. README — Setup & Run

The README must include:

### Prerequisites
- Node.js 24+
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

The server statically serves `../client/dist` when `NODE_ENV=production`.

---

## 7. Acceptance Criteria

Phase 1 is complete when all of the following are true:

- [ ] The server starts without errors and creates the SQLite DB and all tables on first run
- [ ] `generate_communities.py` populates at least 20 communities successfully
- [ ] `generate_users.py --count 100` creates 100 AI users without crashing
- [ ] `generate_posts.py --date today --count 50` creates 50 posts distributed across communities with valid `scheduled_at` timestamps
- [ ] The home feed loads and displays posts sorted by hot/new/top
- [ ] Posts with a `scheduled_at` in the future do NOT appear in the feed
- [ ] Running `generate_posts.py` again with tomorrow's date makes 0 new posts appear until that date arrives
- [ ] Clicking a post opens post detail with full body text
- [ ] Logging in with any username persists the session across page refreshes (session expires after 30 days of inactivity)
- [ ] Voting on a post updates the score optimistically in the UI and persists to the DB; `score = upvote_count - downvote_count` is always true
- [ ] The app renders correctly in both light and dark mode; the theme toggle in the navbar works and persists
- [ ] The app is installable as a PWA on an Android or iOS device
- [ ] The app is accessible from another device on the LAN at the server machine's IP
- [ ] The feed uses infinite scroll (cursor-based pagination) with no visible jank on mobile
- [ ] Community pages show only that community's posts
- [ ] User profile pages show that user's posts

---

## 8. Out of Scope for Phase 1

The following are explicitly deferred and should NOT be implemented:

- Comment generation (Phase 2)
- Real user post creation (Phase 2+)
- Trending/popularity algorithm (Phase 2)
- Settings screen (Phase 2)
- Score update background job (Phase 2)
- Search functionality (Phase 3)
- Notifications (Phase 3+)
- Image/video post types (Phase 3 stubs, Phase 4 generation)
- Markdown rendering (Phase 3)
- Direct messages
- Moderation tools
