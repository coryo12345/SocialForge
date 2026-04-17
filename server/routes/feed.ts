import { Router } from 'express';
import db from '../db.js';
import type { FeedPost, PaginatedResponse } from '../../shared/types.js';

const router = Router();

function feedQuery(now: number) {
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
    WHERE p.is_removed = 0
  `;
}

function hotScore(scheduledAt: number, score: number): number {
  const ageHours = (Date.now() / 1000 - scheduledAt) / 3600;
  return score / Math.pow(ageHours + 2, 1.5);
}

router.get('/', (req, res) => {
  const sort = (req.query.sort as string) || 'hot';
  const limitRaw = Math.min(parseInt(req.query.limit as string) || 25, 50);
  const cursor = req.query.cursor as string | undefined;
  const now = Math.floor(Date.now() / 1000);

  if (sort === 'new') {
    let items: FeedPost[];
    if (cursor) {
      items = db
        .prepare(
          `${feedQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at < ?
           ORDER BY p.scheduled_at DESC LIMIT ?`,
        )
        .all(now, parseInt(cursor), limitRaw + 1) as FeedPost[];
    } else {
      items = db
        .prepare(`${feedQuery(now)} AND p.scheduled_at <= ? ORDER BY p.scheduled_at DESC LIMIT ?`)
        .all(now, limitRaw + 1) as FeedPost[];
    }

    const hasMore = items.length > limitRaw;
    const page = hasMore ? items.slice(0, limitRaw) : items;
    const nextCursor = hasMore ? String(page[page.length - 1].scheduled_at) : null;
    const response: PaginatedResponse<FeedPost> = { items: page, nextCursor };
    res.json(response);
    return;
  }

  if (sort === 'top') {
    let items: FeedPost[];
    if (cursor) {
      const { score, id } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
        score: number;
        id: number;
      };
      items = db
        .prepare(
          `${feedQuery(now)} AND p.scheduled_at <= ?
           AND (p.score < ? OR (p.score = ? AND p.id < ?))
           ORDER BY p.score DESC, p.id DESC LIMIT ?`,
        )
        .all(now, score, score, id, limitRaw + 1) as FeedPost[];
    } else {
      items = db
        .prepare(
          `${feedQuery(now)} AND p.scheduled_at <= ? ORDER BY p.score DESC, p.id DESC LIMIT ?`,
        )
        .all(now, limitRaw + 1) as FeedPost[];
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

  // hot sort: fetch top 500 recent posts, compute hot score in JS
  const cutoff = now - 48 * 60 * 60;
  const pool = db
    .prepare(
      `${feedQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at >= ?
       ORDER BY p.scheduled_at DESC LIMIT 500`,
    )
    .all(now, cutoff) as FeedPost[];

  const scored = pool
    .map((p) => ({ post: p, hot: hotScore(p.scheduled_at, p.score) }))
    .sort((a, b) => b.hot - a.hot);

  const offset = cursor ? parseInt(cursor) : 0;
  const page = scored.slice(offset, offset + limitRaw).map((x) => x.post);
  const nextOffset = offset + limitRaw;
  const nextCursor = nextOffset < scored.length ? String(nextOffset) : null;

  const response: PaginatedResponse<FeedPost> = { items: page, nextCursor };
  res.json(response);
});

export default router;
