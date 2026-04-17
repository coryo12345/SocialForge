import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  const tryAdd = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch {}
  };

  tryAdd('posts', 'view_count',    'INTEGER NOT NULL DEFAULT 0');
  tryAdd('users', 'post_count',    'INTEGER NOT NULL DEFAULT 0');
  tryAdd('users', 'comment_count', 'INTEGER NOT NULL DEFAULT 0');
};

export const down: Migration = async () => {
  // SQLite does not support DROP COLUMN on older versions — no-op
};
