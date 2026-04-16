# SocialForge

A self-hosted, AI-generated social media simulator. Generates and displays a continuous stream of fake social media content powered by local LLMs (Ollama). Think Reddit — but every user, post, and comment is AI-generated.

---

## TODOs
- member count for community shows as 0 when viewing post
- nuclearrevenge/pettyrevenge descriptions is NOT prompting for the right content lol
- Community images (generate locally)
- User images (create locally? or store a few)
- favicon
- place in app to view users
- place to view all communities

## Prerequisites

- Node.js 24+
- Python 3.10+
- [Ollama](https://ollama.ai) installed and running (`ollama serve`)
- Model pulled: `ollama pull llama3.1:8b`
- Build tools for `better-sqlite3`: `sudo apt-get install make g++` (Linux/WSL)

---

## First-Time Setup

```bash
# 1. Install server dependencies
cd server && npm install

# 2. Install client dependencies
cd ../client && npm install

# 3. Install Python dependencies
cd ../scripts && pip install -r requirements.txt

# 4. Copy env files (edit as needed)
cp server/.env.example server/.env
cp client/.env.example client/.env
```

---

## Running the App

```bash
# Terminal 1: Start server (port 3001)
cd server && npm run dev

# Terminal 2: Start client (port 5173)
cd client && npm run dev
```

Open http://localhost:5173

---

## Generating Content

Run these once to set up the database, then run the posts script regularly.

```bash
cd scripts

# Step 1: Create communities (run once)
python generate_communities.py

# Step 2: Create AI users (run once, or again to add more)
python generate_users.py --count 100

# Step 3: Generate today's posts
python generate_posts.py --date today --count 50

# Generate for a specific date
python generate_posts.py --date 2025-06-15 --count 100

# Generate for a specific community only
python generate_posts.py --date today --count 20 --community technology
```

---

## LAN Access (PWA on mobile)

```bash
# 1. Find your LAN IP
ip addr | grep "inet " | grep -v 127

# 2. Update server/.env — add your LAN IP to CORS_ORIGIN
CORS_ORIGIN=http://localhost:5173,http://<YOUR-IP>:5173

# 3. Update client/.env
VITE_API_URL=http://<YOUR-IP>:3001

# 4. Build and serve
cd client && npm run build
cd ../server && npm run serve-client
# Open http://<YOUR-IP>:3001 on any device on the network
```

---

## Project Structure

```
SocialForge/
├── server/          Express 5 + TypeScript + SQLite API (port 3001)
├── client/          React 19 + Vite 6 + TailwindCSS v4 PWA (port 5173)
├── shared/          Shared TypeScript types
├── scripts/         Python content generation scripts (Ollama)
├── data/            SQLite database file (gitignored)
└── specs/           Phase design specifications
```

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Reddit-style MVP — feed, communities, voting, login | ✅ Complete |
| 2 | Comments, trending, settings screen | Planned |
| 3 | Cross-user interactions, search, personalization | Planned |
| 4 | Media generation, TikTok/YouTube feed | Planned |
