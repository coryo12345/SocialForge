import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  const seed = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, label, description, category, type) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const seedAll = db.transaction(() => {
    const rows: [string, string, string, string, string, string][] = [
      ['relationships_enabled', 'true', 'Enable relationship-based comments', 'Use user relationships to bias comment author selection', 'Generation', 'boolean'],
      ['memory_enabled', 'true', 'Enable user memory in generation', 'Include user memory summaries in generation prompts', 'Generation', 'boolean'],
      ['personalized_feed_enabled', 'true', 'Enable personalized feed', 'Show "For You" tab on home feed based on activity', 'Feed Algorithm', 'boolean'],
      ['activity_feed_lookback_days', '7', 'Activity feed lookback (days)', 'How many days back to look for activity feed events', 'Feed Algorithm', 'number'],
      ['search_fts_enabled', 'true', 'Enable full-text search', 'Use SQLite FTS5 for post search', 'Search', 'boolean'],
      ['search_max_results', '20', 'Max search results per type', 'Maximum number of results returned per search type', 'Search', 'number'],
      ['markdown_render_posts', 'true', 'Render Markdown in posts', 'Render Markdown formatting in post bodies', 'Display', 'boolean'],
      ['markdown_render_comments', 'true', 'Render Markdown in comments', 'Render Markdown formatting in comment bodies', 'Display', 'boolean'],
      ['show_ai_persona_on_profile', 'true', 'Show AI persona on profiles', 'Display AI personality details on user profile About tab', 'Display', 'boolean'],
    ];
    for (const row of rows) seed.run(...row);
  });
  seedAll();
};

export const down: Migration = async ({ context: { db } }) => {
  const keys = [
    'relationships_enabled', 'memory_enabled', 'personalized_feed_enabled',
    'activity_feed_lookback_days', 'search_fts_enabled', 'search_max_results',
    'markdown_render_posts', 'markdown_render_comments', 'show_ai_persona_on_profile',
  ];
  const del = db.prepare(`DELETE FROM settings WHERE key = ?`);
  db.transaction(() => { for (const k of keys) del.run(k); })();
};
