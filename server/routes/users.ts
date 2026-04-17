import { Router } from 'express';
import db from '../db.js';
import type { FeedPost, CommentWithAuthor, PaginatedResponse } from '../../shared/types.js';

const router = Router();

const PUBLIC_USER_FIELDS = `
  id, username, display_name, avatar_seed, bio, is_real_user, karma, post_count, comment_count, created_at
`;

router.get('/', (req, res) => {
  const limitRaw = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const cursor = req.query.cursor as string | undefined;

  let items: { karma: number }[];
  if (cursor) {
    items = db
      .prepare(
        `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE is_real_user = 0 AND karma < ? ORDER BY karma DESC LIMIT ?`,
      )
      .all(parseInt(cursor), limitRaw + 1) as { karma: number }[];
  } else {
    items = db
      .prepare(
        `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE is_real_user = 0 ORDER BY karma DESC LIMIT ?`,
      )
      .all(limitRaw + 1) as { karma: number }[];
  }

  const hasMore = items.length > limitRaw;
  const page = hasMore ? items.slice(0, limitRaw) : items;
  res.json({
    items: page,
    nextCursor: hasMore ? String(page[page.length - 1].karma) : null,
  });
});

router.get('/:username', (req, res) => {
  const user = db
    .prepare(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE username = ?`)
    .get(req.params.username);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

router.get('/:username/posts', (req, res) => {
  const limitRaw = Math.min(parseInt(req.query.limit as string) || 25, 50);
  const cursor = req.query.cursor as string | undefined;
  const now = Math.floor(Date.now() / 1000);

  const user = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(req.params.username) as { id: number } | undefined;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let items: FeedPost[];
  if (cursor) {
    items = db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND scheduled_at <= ${now} AND is_removed = 0) AS comment_count,
           c.name AS community_name, c.display_name AS community_display_name,
           c.banner_color AS community_banner_color,
           u.username AS author_username, u.display_name AS author_display_name,
           u.avatar_seed AS author_avatar_seed
         FROM posts p
         JOIN communities c ON p.community_id = c.id
         JOIN users u ON p.user_id = u.id
         WHERE p.user_id = ? AND p.is_removed = 0 AND p.scheduled_at <= ?
           AND p.scheduled_at < ?
         ORDER BY p.scheduled_at DESC LIMIT ?`,
      )
      .all(user.id, now, parseInt(cursor), limitRaw + 1) as FeedPost[];
  } else {
    items = db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND scheduled_at <= ${now} AND is_removed = 0) AS comment_count,
           c.name AS community_name, c.display_name AS community_display_name,
           c.banner_color AS community_banner_color,
           u.username AS author_username, u.display_name AS author_display_name,
           u.avatar_seed AS author_avatar_seed
         FROM posts p
         JOIN communities c ON p.community_id = c.id
         JOIN users u ON p.user_id = u.id
         WHERE p.user_id = ? AND p.is_removed = 0 AND p.scheduled_at <= ?
         ORDER BY p.scheduled_at DESC LIMIT ?`,
      )
      .all(user.id, now, limitRaw + 1) as FeedPost[];
  }

  const hasMore = items.length > limitRaw;
  const page = hasMore ? items.slice(0, limitRaw) : items;
  const response: PaginatedResponse<FeedPost> = {
    items: page,
    nextCursor: hasMore ? String(page[page.length - 1].scheduled_at) : null,
  };
  res.json(response);
});

router.get('/:username/comments', (req, res) => {
  const limitRaw = Math.min(parseInt(req.query.limit as string) || 25, 50);
  const cursor = req.query.cursor as string | undefined;
  const now = Math.floor(Date.now() / 1000);

  const user = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(req.params.username) as { id: number } | undefined;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const BASE_COMMENT_QUERY = `
    SELECT c.*,
      u.username AS author_username, u.display_name AS author_display_name,
      u.avatar_seed AS author_avatar_seed,
      comm.name AS community_name
    FROM comments c
    JOIN users u ON c.user_id = u.id
    JOIN posts p ON c.post_id = p.id
    JOIN communities comm ON p.community_id = comm.id
    WHERE c.user_id = ? AND c.is_removed = 0 AND c.scheduled_at <= ?
  `;

  let items: CommentWithAuthor[];
  if (cursor) {
    items = db
      .prepare(`${BASE_COMMENT_QUERY} AND c.scheduled_at < ? ORDER BY c.scheduled_at DESC LIMIT ?`)
      .all(user.id, now, parseInt(cursor), limitRaw + 1) as CommentWithAuthor[];
  } else {
    items = db
      .prepare(`${BASE_COMMENT_QUERY} ORDER BY c.scheduled_at DESC LIMIT ?`)
      .all(user.id, now, limitRaw + 1) as CommentWithAuthor[];
  }

  const hasMore = items.length > limitRaw;
  const page = hasMore ? items.slice(0, limitRaw) : items;
  const response: PaginatedResponse<CommentWithAuthor> = {
    items: page,
    nextCursor: hasMore ? String(page[page.length - 1].scheduled_at) : null,
  };
  res.json(response);
});

export default router;
