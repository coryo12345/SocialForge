import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_relationships (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id_a         INTEGER NOT NULL REFERENCES users(id),
      user_id_b         INTEGER NOT NULL REFERENCES users(id),
      relationship_type TEXT    NOT NULL
                          CHECK (relationship_type IN ('ally','rival','acquaintance','fan')),
      strength          REAL    NOT NULL DEFAULT 0.5
                          CHECK (strength >= 0.0 AND strength <= 1.0),
      notes             TEXT,
      created_at        INTEGER NOT NULL,
      UNIQUE(user_id_a, user_id_b)
    );

    CREATE INDEX IF NOT EXISTS idx_relationships_a ON user_relationships(user_id_a);
    CREATE INDEX IF NOT EXISTS idx_relationships_b ON user_relationships(user_id_b);

    CREATE TABLE IF NOT EXISTS user_memory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      memory_type TEXT    NOT NULL
                    CHECK (memory_type IN ('opinion','topic','community_familiarity')),
      key         TEXT    NOT NULL,
      value       TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE(user_id, memory_type, key)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_user ON user_memory(user_id);

    CREATE TABLE IF NOT EXISTS user_activity (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      action_type TEXT    NOT NULL
                    CHECK (action_type IN ('view_post','visit_community','upvote','downvote','dwell')),
      target_id   INTEGER NOT NULL,
      target_type TEXT    NOT NULL CHECK (target_type IN ('post','community','user')),
      metadata    TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_user    ON user_activity(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_target  ON user_activity(target_id, target_type);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON user_activity(created_at DESC);
  `);
};

export const down: Migration = async ({ context: { db } }) => {
  db.exec(`
    DROP TABLE IF EXISTS user_activity;
    DROP TABLE IF EXISTS user_memory;
    DROP TABLE IF EXISTS user_relationships;
  `);
};
