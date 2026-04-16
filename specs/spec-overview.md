# SocialForge — Master Project Overview

## What Is This?

SocialForge is a self-hosted, AI-generated social media simulator. It is a personal tool — a single-user app you run on your own machine — that generates and displays a continuous stream of fake social media content powered by local LLMs. Think of it as a sandbox social network where every user, post, and comment is AI-generated.

The goal is to simulate the experience of scrolling through Reddit, TikTok, and YouTube with a realistic content stream — without any of the real-world noise, algorithms, or data concerns.

---

## Architecture Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                         LOCAL MACHINE                            │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────────┐   │
│  │  React PWA  │────▶│ Express API │────▶│   SQLite (DB)    │   │
│  │  (Vite)     │     │ (Node.js)   │     │ SocialForge.db     │   │
│  │  Port 5173  │     │  Port 3001  │     └──────────────────┘   │
│  └─────────────┘     └─────────────┘                            │
│                              ▲                                   │
│                              │                                   │
│  ┌──────────────────────────────────────────────┐               │
│  │          Python Generation Scripts           │               │
│  │  generate_users.py   generate_posts.py [P1] │               │
│  │  generate_comments.py  generate_daily.py[P2]│               │
│  └──────────────────────────────────────────────┘               │
│                              │                                   │
│  ┌─────────────┐  ┌──────────────────────────┐                  │
│  │   Ollama    │  │  ComfyUI (Phase 4+)       │                  │
│  │  Port 11434 │  │  Port 8188 (optional)     │                  │
│  └─────────────┘  └──────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

All components run locally. The React app and the API can be accessed from any device on the local network (phone, tablet, etc.) for a realistic mobile browsing experience.

---

## Phase Summary

| Phase | Name | Core Deliverable | Status |
|-------|------|-----------------|--------|
| 1 | Reddit-Style MVP | Posts feed, communities, voting, user generation scripts | Spec complete |
| 2 | Comments & Settings | Threaded comments, trending, settings screen | Spec complete |
| 3 | Interactions & Intelligence | Cross-user dynamics, personalized feed, search, Markdown | Spec complete |
| 4 | Media & Advanced Simulation | Image/video posts, TikTok feed, user arcs, follower simulation | Spec complete |

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Node.js 24 + Express 5 + TypeScript | Lightweight, fast, async error handling built-in |
| Database | SQLite via better-sqlite3 v11 | Zero-config, single file, perfect for personal apps |
| Frontend | React 19 + Vite 6 + TypeScript | Fast dev server, easy PWA support, latest concurrent features |
| Routing | React Router v7 (library mode) | Stable, same mental model as v6 |
| Styling | TailwindCSS v4 | CSS-first config, `@theme` for design tokens |
| State | Zustand v5 + TanStack Query v5 | Simple global state + powerful data fetching |
| PWA | vite-plugin-pwa + Workbox | Service worker, offline, installable |
| LLM | Ollama (llama3.1:8b) | Local, private, free |
| Image gen | ComfyUI (Phase 4) | Local Stable Diffusion |
| Scripts | Python 3.10+ | Excellent for LLM API integration |

---

## Hardware Requirements

| Phase | Minimum | Recommended |
|-------|---------|-------------|
| 1-3 (text only) | GTX 1060 6GB | GTX 4060 8GB |
| 4 (image gen) | GTX 3060 12GB | RTX 3070+ 8GB+ |
| 4 (video gen) | RTX 3080 10GB+ | RTX 4080+ |

The project is designed to degrade gracefully. Image and video generation are opt-in. Phase 1-3 run comfortably on the specified GTX 4060 8GB.

**Recommended Ollama model for 8GB VRAM:**
- Primary: `llama3.1:8b` (Q4_K_M quantization)
- Alternative: `mistral:7b` (slightly faster, slightly less quality)
- Quality upgrade: `llama3.1:8b-q8` (requires ~9GB, may cause OOM — use Q4 instead)

OR potentially the new gemma4 models. Do some research before deciding.

---

## Data Flow: How Content Gets Generated

```
1. SETUP (run once)
   python generate_communities.py     → creates 30 communities
   python generate_users.py --count 1000  → creates 1000 AI personas

2. DAILY GENERATION (run on schedule or manually)
   python generate_daily.py --date today
     └─ generate_posts.py --date today     → creates ~100 posts, scheduled throughout the day
     └─ generate_comments.py --date today  → creates comment threads for those posts

3. THE APP (running continuously)
   Express server: serves API + static client
   Background job: updates scores every 15 minutes
   API filter: only returns posts/comments where scheduled_at <= now()

4. RESULT
   As the day progresses, posts "appear" in your feed as if being posted in real time.
   Comment threads fill in over hours.
   Hot posts rise to the top.
   You scroll, vote, and read — indistinguishable from the real thing.
```

---

## Key Design Decisions

### Why SQLite and not Postgres/MySQL?

This is a personal, single-user app. SQLite is a file — no server to run, no connection pooling, trivial backup (copy one file), trivially fast for the data volumes involved (millions of rows is fine for SQLite on local hardware). `better-sqlite3` is synchronous, which is actually a feature here — no async complexity in route handlers.

### Why "scheduled_at" instead of just inserting posts with past timestamps?

The scheduled_at approach lets you pre-generate all content for a week in one sitting (useful when you want to "prime the pump" for a vacation or just want a buffer). Posts sit in the DB with future timestamps and become visible as time passes. This is the core mechanic that makes the platform feel alive without needing the generation scripts to run continuously.

### Why separate generation scripts instead of the server generating content?

Separation of concerns. The server is a read/query API. Generation is a batch process with very different operational characteristics — it's CPU/GPU intensive, long-running, and you want to control when it runs. Running it as a separate script means you can run it from a cron job, manually, or not at all. It also makes it easier to kill/restart without affecting the running app.

### Why Python for scripts and not Node.js?

Python has a dramatically better ecosystem for LLM integration (`ollama` library, `langchain`, Hugging Face tools) and for future data science needs. The scripts are entirely separate from the Node.js server — they just call the HTTP API.

---

## Recommended Development Order

Within each phase, tackle components in this order:

### Phase 1
1. DB schema + Express boilerplate
2. Internal bulk insert endpoints
3. `generate_communities.py` + `generate_users.py`
4. Feed + Posts GET endpoints
5. React app skeleton + routing
6. Home feed page + PostCard component
7. Community page
8. PostDetail page (no comments yet)
9. Login page + session
10. Voting (VoteButton + POST endpoints)
11. `generate_posts.py`
12. PWA config + LAN serving

### Phase 2
1. Comments table + GET endpoint
2. CommentThread component
3. `generate_comments.py`
4. Settings table + API
5. Settings page UI
6. Score update background job
7. Hot sort algorithm
8. Trending communities
9. Real user commenting UI + POST endpoint
10. `generate_daily.py` wrapper

### Phase 3
1. User relationships table + `generate_relationships.py`
2. Enhanced comment generation with relationship awareness
3. User memory table + `build_user_memory.py`
4. User activity tracking
5. Personalized feed endpoint + "For You" tab
6. SQLite FTS setup + search endpoint
7. Search UI (navbar + search page)
8. Markdown rendering
9. Activity page
10. PWA offline support + shortcuts
11. Enhanced user profile

### Phase 4
1. Image schema additions
2. Media static file serving
3. `generate_image_posts.py`
4. Image post UI (PostCard + PostDetail)
5. Browse feed page
6. Video schema additions
7. TikTok feed route + UI
8. `generate_video_posts.py` (stub → real)
9. User arc simulation tables + `simulate_arcs.py`
10. Follower simulation
11. Settings dashboard

---

## File: `.env.example` (Server)

```env
# Server
PORT=3001
NODE_ENV=development

# Database
DB_PATH=../data/SocialForge.db

# Security
INTERNAL_API_KEY=change-this-to-something-secret
SESSION_SECRET=change-this-too

# CORS — comma-separated list of allowed origins (add LAN IP for mobile access)
# e.g., CORS_ORIGIN=http://localhost:5173,http://192.168.1.50:5173
CORS_ORIGIN=http://localhost:5173
```

## File: `.env.example` (Client)

```env
# Set to your server's LAN IP for mobile PWA access
# e.g., http://192.168.1.50:3001
VITE_API_URL=http://localhost:3001
```

## File: `scripts/config.py`

```python
import os

OLLAMA_BASE_URL   = os.getenv("OLLAMA_URL",     "http://localhost:11434")
OLLAMA_MODEL      = os.getenv("OLLAMA_MODEL",   "llama3.1:8b")
APP_API_URL       = os.getenv("APP_API_URL",    "http://localhost:3001/api")
INTERNAL_API_KEY  = os.getenv("INTERNAL_API_KEY", "change-this-to-something-secret")

INTERNAL_HEADERS = {"X-Internal-Key": INTERNAL_API_KEY}
```

---

## Glossary

| Term | Meaning in SocialForge |
|------|---------------------|
| Community | Equivalent to a subreddit — a topic-based group |
| Post | A text, link, image, or video submission |
| AI User | A generated persona with personality, interests, and communication style |
| Real User | The actual human using the app (you) |
| scheduled_at | Unix timestamp when a post/comment becomes visible in the feed |
| created_at | Unix timestamp when the row was inserted into the DB (usually earlier) |
| Hot score | A time-decayed score used to rank the home feed |
| Arc | A temporary narrative state for an AI user (viral, burnout, etc.) |
| Memory | A stored summary of an AI user's past opinions, used to ensure consistency |
| Internal API | API endpoints only accessible with the INTERNAL_API_KEY header, used by scripts |

---

## Spec Documents

- [Phase 1 — Reddit-Style MVP](./spec-phase1.md)
- [Phase 2 — Comments, Popularity & Settings](./spec-phase2.md)
- [Phase 3 — Cross-User Interactions, Persona Depth & Feed Intelligence](./spec-phase3.md)
- [Phase 4 — Media Generation, TikTok/YouTube Feed & Advanced Simulation](./spec-phase4.md)
