import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
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
};

export const down: Migration = async ({ context: { db } }) => {
  db.exec(`
    DROP TABLE IF EXISTS jobs_log;
    DROP TABLE IF EXISTS settings;
  `);
};
