import type { Migration } from '../migrator.js';

export const up: Migration = async ({ context: { db } }) => {
  const seed = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, label, description, category, type) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const seedAll = db.transaction(() => {
    const rows: [string, string, string, string, string, string][] = [
      ['posts_per_day_min', '50', 'Min posts per day', 'Minimum number of posts generated per day', 'Content Volume', 'number'],
      ['posts_per_day_max', '150', 'Max posts per day', 'Maximum number of posts generated per day', 'Content Volume', 'number'],
      ['comments_per_post_multiplier', '1.0', 'Comment frequency multiplier', 'Scale factor for comment counts', 'Content Volume', 'number'],
      ['max_comment_depth', '4', 'Max comment thread depth', 'Maximum nesting depth for replies', 'Content Structure', 'number'],
      ['max_top_level_comments', '12', 'Max top-level comments per post', 'Maximum number of root comments per post', 'Content Structure', 'number'],
      ['max_replies_per_comment', '3', 'Max replies per comment', 'Maximum direct replies per comment', 'Content Structure', 'number'],
      ['title_only_post_ratio', '0.3', 'Ratio of title-only posts', 'Fraction of posts with no body text', 'Content Style', 'number'],
      ['hot_score_decay_hours', '12', 'Hot score half-life (hours)', 'Controls how quickly posts fade from hot sort', 'Feed Algorithm', 'number'],
      ['score_update_interval_minutes', '15', 'Score update job interval', 'How often the background scoring job runs', 'Feed Algorithm', 'number'],
      ['viral_post_probability', '0.05', 'Chance of a viral post', 'Probability a post gets a very high initial score', 'Feed Algorithm', 'number'],
      ['ollama_model', 'qwen2.5:3b', 'Ollama model name', 'The Ollama model used for content generation', 'Generation', 'string'],
      ['ollama_temperature', '0.8', 'LLM temperature', 'Sampling temperature for generation (0.0–2.0)', 'Generation', 'number'],
      ['community_post_weight_by_size', 'true', 'Weight post distribution by community size', 'Larger communities get more posts', 'Generation', 'boolean'],
      ['generation_timezone', 'America/New_York', 'Timezone for post scheduling', 'Timezone used for scheduling post times', 'Generation', 'string'],
      ['activity_peak_hours', '[9,22]', 'Active hour range (start, end)', 'JSON array [start, end] for peak posting hours', 'Generation', 'string'],
      ['default_post_sort', 'hot', 'Default feed sort', 'Default sort order for the home feed', 'Display', 'select'],
      ['posts_per_page', '25', 'Posts per page', 'Number of posts loaded per page', 'Display', 'number'],
      ['show_user_karma', 'true', 'Show karma scores', 'Display karma scores on user profiles', 'Display', 'boolean'],
    ];
    for (const row of rows) seed.run(...row);
  });
  seedAll();
};

export const down: Migration = async ({ context: { db } }) => {
  db.exec(`DELETE FROM settings`);
};
