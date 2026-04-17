import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { mkdirSync } from 'fs';
import { runMigrations } from './migrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.dirname(config.DB_PATH);
mkdirSync(dbDir, {recursive: true});
const resolvedPath = path.resolve(__dirname, config.DB_PATH);

const db = new Database(resolvedPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

await runMigrations(db);

// Purge expired sessions on startup
const now = Math.floor(Date.now() / 1000);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

export default db;
