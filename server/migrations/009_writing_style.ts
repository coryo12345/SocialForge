import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  db.exec(`ALTER TABLE users ADD COLUMN writing_style TEXT;`);
  db.exec(`ALTER TABLE users DROP COLUMN communication_style;`);
};

export const down: Migration = async (_params) => {
  // SQLite does not support DROP COLUMN in older versions; left as no-op
};
