import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  db.exec(`ALTER TABLE users    ADD COLUMN model TEXT;`);
  db.exec(`ALTER TABLE posts    ADD COLUMN model TEXT;`);
  db.exec(`ALTER TABLE comments ADD COLUMN model TEXT;`);

  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, label, description, category, type)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'show_model_label',
    'false',
    'Show model label on content',
    'Display the AI model name used to generate posts and comments',
    'Display',
    'boolean',
  );
};

export const down: Migration = async (_params) => {
  // SQLite DROP COLUMN unreliable; only roll back the setting row
  // db.prepare(`DELETE FROM settings WHERE key = 'show_model_label'`).run();
};
