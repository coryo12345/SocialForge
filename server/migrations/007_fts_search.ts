import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      title,
      body,
      content='posts',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );
  `);

  // Populate existing posts
  db.exec(`
    INSERT INTO posts_fts(rowid, title, body)
    SELECT id, title, COALESCE(body, '') FROM posts WHERE is_removed = 0;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS posts_fts_ai
    AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, body)
      VALUES (new.id, new.title, COALESCE(new.body, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS posts_fts_au
    AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, COALESCE(old.body, ''));
      INSERT INTO posts_fts(rowid, title, body)
      VALUES (new.id, new.title, COALESCE(new.body, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS posts_fts_ad
    AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, COALESCE(old.body, ''));
    END;
  `);
};

export const down: Migration = async ({ context: { db } }) => {
  db.exec(`
    DROP TRIGGER IF EXISTS posts_fts_ad;
    DROP TRIGGER IF EXISTS posts_fts_au;
    DROP TRIGGER IF EXISTS posts_fts_ai;
    DROP TABLE IF EXISTS posts_fts;
  `);
};
