import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  const tryAdd = (col: string, def: string) => {
    try { db.exec(`ALTER TABLE posts ADD COLUMN ${col} ${def}`); } catch {}
  };

  tryAdd('media_url',              'TEXT');
  tryAdd('media_type',             'TEXT');
  tryAdd('thumbnail_url',          'TEXT');
  tryAdd('media_width',            'INTEGER');
  tryAdd('media_height',           'INTEGER');
  tryAdd('media_duration_seconds', 'INTEGER');
};

export const down: Migration = async () => {
  // SQLite does not support DROP COLUMN on older versions — no-op
};
