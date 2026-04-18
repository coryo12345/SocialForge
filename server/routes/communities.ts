import { Router } from 'express';
import db from '../db.js';
import type { Community, FeedPost, PaginatedResponse } from '../../shared/types.js';

const router = Router();

function postQuery(now: number) {
  return `
    SELECT
      p.*,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND scheduled_at <= ${now} AND is_removed = 0) AS comment_count,
      c.name         AS community_name,
      c.display_name AS community_display_name,
      c.banner_color AS community_banner_color,
      u.username     AS author_username,
      u.display_name AS author_display_name,
      u.avatar_seed  AS author_avatar_seed
    FROM posts p
    JOIN communities c ON p.community_id = c.id
    JOIN users u       ON p.user_id = u.id
    WHERE p.is_removed = 0 AND c.name = ?
  `;
}

router.get('/', (req, res) => {
  const search = (req.query.search as string) || '';
  let communities: Community[];
  if (search) {
    communities = db
      .prepare(
        `SELECT * FROM communities
         WHERE name LIKE ? OR display_name LIKE ?
         ORDER BY member_count DESC`,
      )
      .all(`%${search}%`, `%${search}%`) as Community[];
  } else {
    communities = db
      .prepare('SELECT * FROM communities ORDER BY member_count DESC')
      .all() as Community[];
  }
  res.json(communities);
});

router.get('/trending', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, COUNT(p.id) as recent_posts, COALESCE(SUM(p.score), 0) as total_score
       FROM posts p
       JOIN communities c ON p.community_id = c.id
       WHERE p.scheduled_at > (strftime('%s','now') - 86400)
         AND p.scheduled_at <= strftime('%s','now')
       GROUP BY p.community_id
       ORDER BY recent_posts DESC, total_score DESC
       LIMIT 5`,
    )
    .all();
  res.json(rows);
});

router.get('/:name', (req, res) => {
  const community = db
    .prepare('SELECT * FROM communities WHERE name = ?')
    .get(req.params.name) as Community | undefined;
  if (!community) {
    res.status(404).json({ error: 'Community not found' });
    return;
  }
  res.json(community);
});

router.get('/:name/posts', (req, res) => {
  const sort = (req.query.sort as string) || 'hot';
  const limitRaw = Math.min(parseInt(req.query.limit as string) || 25, 50);
  const cursor = req.query.cursor as string | undefined;
  const now = Math.floor(Date.now() / 1000);
  const { name } = req.params;

  // Verify community exists
  const community = db
    .prepare('SELECT id FROM communities WHERE name = ?')
    .get(name) as { id: number } | undefined;
  if (!community) {
    res.status(404).json({ error: 'Community not found' });
    return;
  }

  let items: FeedPost[];

  if (sort === 'new') {
    if (cursor) {
      items = db
        .prepare(
          `${postQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at < ?
           ORDER BY p.scheduled_at DESC LIMIT ?`,
        )
        .all(name, now, parseInt(cursor), limitRaw + 1) as FeedPost[];
    } else {
      items = db
        .prepare(`${postQuery(now)} AND p.scheduled_at <= ? ORDER BY p.scheduled_at DESC LIMIT ?`)
        .all(name, now, limitRaw + 1) as FeedPost[];
    }
    const hasMore = items.length > limitRaw;
    const page = hasMore ? items.slice(0, limitRaw) : items;
    const response: PaginatedResponse<FeedPost> = {
      items: page,
      nextCursor: hasMore ? String(page[page.length - 1].scheduled_at) : null,
    };
    res.json(response);
    return;
  }

  if (sort === 'top') {
    if (cursor) {
      const { score, id } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
        score: number;
        id: number;
      };
      items = db
        .prepare(
          `${postQuery(now)} AND p.scheduled_at <= ?
           AND (p.score < ? OR (p.score = ? AND p.id < ?))
           ORDER BY p.score DESC, p.id DESC LIMIT ?`,
        )
        .all(name, now, score, score, id, limitRaw + 1) as FeedPost[];
    } else {
      items = db
        .prepare(
          `${postQuery(now)} AND p.scheduled_at <= ? ORDER BY p.score DESC, p.id DESC LIMIT ?`,
        )
        .all(name, now, limitRaw + 1) as FeedPost[];
    }
    const hasMore = items.length > limitRaw;
    const page = hasMore ? items.slice(0, limitRaw) : items;
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = page[page.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ score: last.score, id: last.id })).toString(
        'base64',
      );
    }
    const response: PaginatedResponse<FeedPost> = { items: page, nextCursor };
    res.json(response);
    return;
  }

  // hot
  function hotScore(scheduledAt: number, score: number): number {
    const ageHours = (Date.now() / 1000 - scheduledAt) / 3600;
    return score / Math.pow(ageHours + 2, 1.5);
  }
  const cutoff = now - 48 * 60 * 60;
  const pool = db
    .prepare(
      `${postQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at >= ?
       ORDER BY p.scheduled_at DESC LIMIT 500`,
    )
    .all(name, now, cutoff) as FeedPost[];

  const scored = pool
    .map((p) => ({ post: p, hot: hotScore(p.scheduled_at, p.score) }))
    .sort((a, b) => b.hot - a.hot);

  const offset = cursor ? parseInt(cursor) : 0;
  const page = scored.slice(offset, offset + limitRaw).map((x) => x.post);
  const nextOffset = offset + limitRaw;
  const response: PaginatedResponse<FeedPost> = {
    items: page,
    nextCursor: nextOffset < scored.length ? String(nextOffset) : null,
  };
  res.json(response);
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid community id' });
    return;
  }
  const { member_count } = req.body as { member_count?: unknown };
  if (
    typeof member_count !== 'number' ||
    !Number.isInteger(member_count) ||
    member_count < 0 ||
    member_count > 2_500_000
  ) {
    res.status(400).json({ error: 'member_count must be an integer between 0 and 2500000' });
    return;
  }
  const result = db
    .prepare('UPDATE communities SET member_count = ? WHERE id = ?')
    .run(member_count, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Community not found' });
    return;
  }
  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(id) as Community;
  res.json(community);
});

export default router;
