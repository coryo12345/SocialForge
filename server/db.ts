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

// Idempotent column additions (ALTER TABLE fails if column already exists)
const addColumn = (table: string, column: string, def: string) => {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
};

addColumn('posts', 'view_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'post_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'comment_count', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    label       TEXT NOT NULL,
    description TEXT,
    category    TEXT NOT NULL,
    type        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name    TEXT    NOT NULL,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    status      TEXT    NOT NULL DEFAULT 'running',
    message     TEXT
  );
`);

// Seed default settings (INSERT OR IGNORE — never overwrite user changes)
const seedSettings = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value, label, description, category, type) VALUES (?, ?, ?, ?, ?, ?)`,
);
const seedMany = db.transaction(() => {
  const rows: [string, string, string, string, string, string][] = [
    ['posts_per_day_min', '50', 'Min posts per day', 'Minimum number of posts generated per day', 'Content Volume', 'number'],
    ['posts_per_day_max', '150', 'Max posts per day', 'Maximum number of posts generated per day', 'Content Volume', 'number'],
    ['comments_per_post_multiplier', '1.0', 'Comment frequency multiplier', 'Scale factor for comment counts', 'Content Volume', 'number'],
    ['max_comment_depth', '4', 'Max comment thread depth', 'Maximum nesting depth for replies', 'Content Structure', 'number'],
    ['max_top_level_comments', '12', 'Max top-level comments per post', 'Maximum number of root comments per post', 'Content Structure', 'number'],
    ['max_replies_per_comment', '3', 'Max replies per comment', 'Maximum direct replies per comment', 'Content Structure', 'number'],
    ['title_only_post_ratio', '0.3', 'Ratio of title-only posts', 'Fraction of posts with no body text', 'Content Style', 'number'],
    ['hot_score_decay_hours', '12', 'Hot score half-life (hours)', 'Controls how quickly posts fade from hot sort', 'Feed Algorithm', 'number'],
    ['score_update_interval_minutes', '15', 'Score update job interval', 'How often the background scoring job runs', 'Feed Algorithm', 'number'],
    ['viral_post_probability', '0.05', 'Chance of a viral post', 'Probability a post gets a very high initial score', 'Feed Algorithm', 'number'],
    ['ollama_model', 'qwen2.5:3b', 'Ollama model name', 'The Ollama model used for content generation', 'Generation', 'string'],
    ['ollama_temperature', '0.8', 'LLM temperature', 'Sampling temperature for generation (0.0–2.0)', 'Generation', 'number'],
    ['community_post_weight_by_size', 'true', 'Weight post distribution by community size', 'Larger communities get more posts', 'Generation', 'boolean'],
    ['generation_timezone', 'America/New_York', 'Timezone for post scheduling', 'Timezone used for scheduling post times', 'Generation', 'string'],
    ['activity_peak_hours', '[9,22]', 'Active hour range (start, end)', 'JSON array [start, end] for peak posting hours', 'Generation', 'string'],
    ['default_post_sort', 'hot', 'Default feed sort', 'Default sort order for the home feed', 'Display', 'select'],
    ['posts_per_page', '25', 'Posts per page', 'Number of posts loaded per page', 'Display', 'number'],
    ['show_user_karma', 'true', 'Show karma scores', 'Display karma scores on user profiles', 'Display', 'boolean'],
  ];
  for (const row of rows) seedSettings.run(...row);
});
seedMany();

// Purge expired sessions on startup
const now = Math.floor(Date.now() / 1000);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

export default db;
