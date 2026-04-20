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

  // Remove ollama_model (no longer meaningful with llama.cpp — model is a server-startup concern)
  db.prepare(`DELETE FROM settings WHERE key = 'ollama_model'`).run();

  // Rename ollama_temperature → llm_temperature
  db.prepare(
    `UPDATE settings SET key = 'llm_temperature', label = 'LLM temperature', description = 'Sampling temperature for generation (0.0–2.0)'
     WHERE key = 'ollama_temperature'`,
  ).run();
};

export const down: Migration = async (_params) => {
  // SQLite DROP COLUMN unreliable; only roll back the setting row
  // db.prepare(`DELETE FROM settings WHERE key = 'show_model_label'`).run();
};
