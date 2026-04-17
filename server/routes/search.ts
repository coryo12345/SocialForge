import { Router } from 'express';
import db from '../db.js';

const router = Router();

function escapeQuery(q: string): string {
  // Remove FTS5 special characters to prevent query errors
  return q.replace(/["*^(){}[\]|&~]/g, ' ').trim();
}

// GET /api/search?q=&type=posts|communities|users&limit=20&offset=0
router.get('/', (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    res.json({ items: [], total: 0, hasMore: false });
    return;
  }

  const type = (req.query.type as string) || 'posts';
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = parseInt(req.query.offset as string) || 0;
  const now = Math.floor(Date.now() / 1000);
  const like = `%${q}%`;

  if (type === 'posts') {
    let items: unknown[];
    const escaped = escapeQuery(q);

    try {
      if (!escaped) throw new Error('empty query');
      items = db.prepare(`
        SELECT p.*,
          c.name AS community_name, c.display_name AS community_display_name,
          c.banner_color AS community_banner_color,
          u.username AS author_username, u.display_name AS author_display_name,
          u.avatar_seed AS author_avatar_seed
        FROM posts_fts
        JOIN posts p ON posts_fts.rowid = p.id
        JOIN communities c ON p.community_id = c.id
        JOIN users u ON p.user_id = u.id
        WHERE posts_fts MATCH ? AND p.is_removed = 0 AND p.scheduled_at <= ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(`"${escaped}"`, now, limit + 1, offset);
    } catch {
      // Fall back to LIKE if FTS fails
      items = db.prepare(`
        SELECT p.*,
          c.name AS community_name, c.display_name AS community_display_name,
          c.banner_color AS community_banner_color,
          u.username AS author_username, u.display_name AS author_display_name,
          u.avatar_seed AS author_avatar_seed
        FROM posts p
        JOIN communities c ON p.community_id = c.id
        JOIN users u ON p.user_id = u.id
        WHERE (p.title LIKE ? OR p.body LIKE ?) AND p.is_removed = 0 AND p.scheduled_at <= ?
        ORDER BY p.score DESC
        LIMIT ? OFFSET ?
      `).all(like, like, now, limit + 1, offset);
    }

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    res.json({ items: page, hasMore, nextOffset: hasMore ? offset + limit : null });
    return;
  }

  if (type === 'communities') {
    const items = db.prepare(`
      SELECT * FROM communities
      WHERE name LIKE ? OR display_name LIKE ? OR description LIKE ?
      ORDER BY member_count DESC
      LIMIT ? OFFSET ?
    `).all(like, like, like, limit + 1, offset);

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    res.json({ items: page, hasMore, nextOffset: hasMore ? offset + limit : null });
    return;
  }

  if (type === 'users') {
    const items = db.prepare(`
      SELECT id, username, display_name, avatar_seed, bio, is_real_user, karma, post_count, comment_count, created_at
      FROM users
      WHERE (username LIKE ? OR display_name LIKE ?) AND is_real_user = 0
      ORDER BY karma DESC
      LIMIT ? OFFSET ?
    `).all(like, like, limit + 1, offset);

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    res.json({ items: page, hasMore, nextOffset: hasMore ? offset + limit : null });
    return;
  }

  res.status(400).json({ error: 'type must be posts, communities, or users' });
});

export default router;
