import type { Migration } from '../migrator.js';

// The post pipeline's per-stage temperatures were read by generate_posts.py but
// never seeded, so they always fell back to the script's literals and were
// invisible in the UI. Seed them at values tuned for the Gemma family, which
// expects sampling near temperature 1.0 rather than the 0.7-0.9 range that
// suited the smaller model this project started on.
export const up: Migration = async ({ context: { db } }) => {
  const seed = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, label, description, category, type) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const seedAll = db.transaction(() => {
    const rows: [string, string, string, string, string, string][] = [
      ['post_ideation_temperature', '1.1', 'Post ideation temperature', 'Sampling temperature for the premise stage of post generation', 'Generation', 'number'],
      ['post_writing_temperature', '1.0', 'Post writing temperature', 'Sampling temperature for the body-writing stage of post generation', 'Generation', 'number'],
      ['post_title_temperature', '1.0', 'Post title temperature', 'Sampling temperature for the title stage of post generation', 'Generation', 'number'],
    ];
    for (const row of rows) seed.run(...row);

    // Repair: migration 010 is recorded as applied on at least one existing
    // database, but its rename and delete did not take effect there — the row
    // is still 'ollama_temperature' and 'ollama_model' is still present. Redo
    // both idempotently. The rename preserves the existing value, so a
    // hand-tuned temperature survives.
    const has = (key: string) =>
      db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(key) !== undefined;

    if (has('ollama_temperature') && !has('llm_temperature')) {
      db.prepare(
        `UPDATE settings SET key = 'llm_temperature', label = 'LLM temperature', description = 'Sampling temperature for generation (0.0–2.0)'
         WHERE key = 'ollama_temperature'`,
      ).run();
    } else if (has('ollama_temperature')) {
      // Both exist somehow — llm_temperature is the live one, drop the stale row
      db.prepare(`DELETE FROM settings WHERE key = 'ollama_temperature'`).run();
    }
    db.prepare(`DELETE FROM settings WHERE key = 'ollama_model'`).run();

    // Raise the comment/relationship/memory temperature into the same range,
    // but only if it is still the value seeded by migration 004 — never clobber
    // a temperature that has been tuned by hand.
    db.prepare(`UPDATE settings SET value = '1.0' WHERE key = 'llm_temperature' AND value = '0.8'`).run();
  });
  seedAll();
};

export const down: Migration = async ({ context: { db } }) => {
  const keys = [
    'post_ideation_temperature', 'post_writing_temperature', 'post_title_temperature',
  ];
  const del = db.prepare(`DELETE FROM settings WHERE key = ?`);
  db.transaction(() => {
    for (const k of keys) del.run(k);
    db.prepare(`UPDATE settings SET value = '0.8' WHERE key = 'llm_temperature' AND value = '1.0'`).run();
  })();
};
