import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.dirname(config.DB_PATH);
mkdirSync(dbDir, {recursive: true});
const resolvedPath = path.resolve(__dirname, config.DB_PATH);

const db = new Database(resolvedPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT    NOT NULL UNIQUE,
    display_name         TEXT    NOT NULL,
    avatar_seed          TEXT    NOT NULL,
    bio                  TEXT,
    age                  INTEGER,
    location             TEXT,
    occupation           TEXT,
    personality          TEXT,
    communication_style  TEXT,
    interests            TEXT,
    political_lean       TEXT,
    is_real_user         INTEGER NOT NULL DEFAULT 0,
    karma                INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS communities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE,
    display_name    TEXT    NOT NULL,
    description     TEXT,
    sidebar_text    TEXT,
    icon_seed       TEXT    NOT NULL,
    banner_color    TEXT    NOT NULL DEFAULT '#c4730a',
    rules           TEXT,
    tags            TEXT,
    member_count      INTEGER NOT NULL DEFAULT 0,
    post_style_prompt TEXT,
    is_narrative      INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id    INTEGER NOT NULL REFERENCES communities(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    title           TEXT    NOT NULL,
    body            TEXT,
    post_type       TEXT    NOT NULL DEFAULT 'text'
                      CHECK (post_type IN ('text','link','image','video')),
    link_url        TEXT,
    score           INTEGER NOT NULL DEFAULT 0,
    upvote_count    INTEGER NOT NULL DEFAULT 0,
    downvote_count  INTEGER NOT NULL DEFAULT 0,
    comment_count   INTEGER NOT NULL DEFAULT 0,
    is_pinned       INTEGER NOT NULL DEFAULT 0,
    is_removed      INTEGER NOT NULL DEFAULT 0,
    removed_at      INTEGER,
    flair           TEXT,
    scheduled_at    INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id);
  CREATE INDEX IF NOT EXISTS idx_posts_score     ON posts(score DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_user      ON posts(user_id);

  CREATE TABLE IF NOT EXISTS comments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id         INTEGER NOT NULL REFERENCES posts(id),
    parent_id       INTEGER REFERENCES comments(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    body            TEXT    NOT NULL,
    score           INTEGER NOT NULL DEFAULT 0,
    upvote_count    INTEGER NOT NULL DEFAULT 0,
    downvote_count  INTEGER NOT NULL DEFAULT 0,
    depth           INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT    PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL
  );
`);

// Purge expired sessions on startup
const now = Math.floor(Date.now() / 1000);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

export default db;
