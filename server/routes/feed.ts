import { Router } from 'express';
import db from '../db.js';
import type { ActivityItem, FeedPost, PaginatedResponse } from '../../shared/types.js';

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

// GET /api/feed/personalized — personalized feed based on user_activity
router.get('/personalized', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const limitRaw = Math.min(parseInt(req.query.limit as string) || 25, 50);
  const cursor = req.query.cursor as string | undefined;
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 3600;

  // Check if user has enough activity
  const activityCount = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM user_activity WHERE user_id = ?`,
  ).get(req.user.id) as { cnt: number }).cnt;

  if (activityCount < 10) {
    // Fall back to hot feed
    const cutoff = now - 48 * 60 * 60;
    const pool = db
      .prepare(`${feedQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at >= ? ORDER BY p.scheduled_at DESC LIMIT 500`)
      .all(now, cutoff) as FeedPost[];
    const scored = pool.map((p) => ({ post: p, hot: hotScore(p.scheduled_at, p.score) })).sort((a, b) => b.hot - a.hot);
    const offset = cursor ? parseInt(cursor) : 0;
    const page = scored.slice(offset, offset + limitRaw).map((x) => x.post);
    const nextOffset = offset + limitRaw;
    res.json({ items: page, nextCursor: nextOffset < scored.length ? String(nextOffset) : null });
    return;
  }

  // Find top communities the user visits
  const topCommunities = db.prepare(`
    SELECT target_id, COUNT(*) AS cnt
    FROM user_activity
    WHERE user_id = ? AND action_type = 'visit_community' AND created_at > ?
    GROUP BY target_id
    ORDER BY cnt DESC
    LIMIT 5
  `).all(req.user.id, thirtyDaysAgo) as Array<{ target_id: number }>;

  // Get post IDs already viewed
  const viewedRows = db.prepare(`
    SELECT DISTINCT target_id FROM user_activity
    WHERE user_id = ? AND action_type IN ('view_post', 'dwell') AND created_at > ?
  `).all(req.user.id, thirtyDaysAgo) as Array<{ target_id: number }>;
  const viewedIds = viewedRows.map((r) => r.target_id);

  let pool: FeedPost[];
  const cutoff = now - 48 * 60 * 60;

  if (topCommunities.length > 0) {
    const communityIds = topCommunities.map((r) => r.target_id);
    const placeholders = communityIds.map(() => '?').join(',');
    const excludePlaceholders = viewedIds.length > 0 ? `AND p.id NOT IN (${viewedIds.map(() => '?').join(',')})` : '';
    pool = db.prepare(
      `${feedQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at >= ?
       AND p.community_id IN (${placeholders})
       ${excludePlaceholders}
       ORDER BY p.scheduled_at DESC LIMIT 350`,
    ).all(now, cutoff, ...communityIds, ...(viewedIds.length > 0 ? viewedIds : [])) as FeedPost[];

    // Supplement with global discovery posts (from other communities) if pool is small
    if (pool.length < limitRaw * 2) {
      const communityExclude = communityIds.map(() => '?').join(',');
      const postExcludeClause = viewedIds.length > 0
        ? `AND p.id NOT IN (${viewedIds.map(() => '?').join(',')})`
        : '';
      const supplement = db.prepare(
        `${feedQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at >= ?
         AND p.community_id NOT IN (${communityExclude})
         ${postExcludeClause}
         ORDER BY p.scheduled_at DESC LIMIT 150`,
      ).all(now, cutoff, ...communityIds, ...(viewedIds.length > 0 ? viewedIds : [])) as FeedPost[];
      pool = [...pool, ...supplement];
    }
  } else {
    pool = db.prepare(
      `${feedQuery(now)} AND p.scheduled_at <= ? AND p.scheduled_at >= ? ORDER BY p.scheduled_at DESC LIMIT 500`,
    ).all(now, cutoff) as FeedPost[];
  }

  const scored = pool.map((p) => ({ post: p, hot: hotScore(p.scheduled_at, p.score) })).sort((a, b) => b.hot - a.hot);
  const offset = cursor ? parseInt(cursor) : 0;
  const page = scored.slice(offset, offset + limitRaw).map((x) => x.post);
  const nextOffset = offset + limitRaw;
  res.json({ items: page, nextCursor: nextOffset < scored.length ? String(nextOffset) : null });
});

// GET /api/feed/activity — notification-style activity stream
router.get('/activity', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 24 * 3600;
  const oneDayAgo = now - 24 * 3600;
  const userId = req.user.id;

  const activityCount = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM user_activity WHERE user_id = ?`,
  ).get(userId) as { cnt: number }).cnt;

  if (activityCount < 10) {
    res.json({ items: [] });
    return;
  }

  const items: ActivityItem[] = [];

  // 1. New comments on posts the user upvoted
  const upvotedPostIds = (db.prepare(`
    SELECT DISTINCT target_id FROM votes
    WHERE user_id = ? AND target_type = 'post' AND value = 1
    LIMIT 50
  `).all(userId) as Array<{ target_id: number }>).map((r) => r.target_id);

  if (upvotedPostIds.length > 0) {
    const placeholders = upvotedPostIds.map(() => '?').join(',');
    const newComments = db.prepare(`
      SELECT c.*, p.title AS post_title, p.id AS post_id,
             u.username AS author_username, u.display_name AS author_display_name,
             u.avatar_seed AS author_avatar_seed,
             comm.name AS community_name
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN users u ON c.user_id = u.id
      JOIN communities comm ON p.community_id = comm.id
      WHERE c.post_id IN (${placeholders})
        AND c.scheduled_at > ?
        AND c.scheduled_at <= ?
        AND c.is_removed = 0
        AND c.user_id != ?
      ORDER BY c.scheduled_at DESC
      LIMIT 15
    `).all(...upvotedPostIds, sevenDaysAgo, now, userId) as Array<Record<string, unknown>>;

    // Fetch the parent post for each comment
    const postCache = new Map<number, FeedPost>();
    for (const comment of newComments) {
      const postId = comment.post_id as number;
      if (!postCache.has(postId)) {
        const post = db.prepare(
          `${feedQuery(now)} AND p.id = ? LIMIT 1`,
        ).get(postId) as FeedPost | undefined;
        if (post) postCache.set(postId, post);
      }
      const post = postCache.get(postId);
      if (post) {
        items.push({
          id: `new_comment_on_upvoted_${comment.id}`,
          reason: 'new_comment_on_upvoted',
          post,
          comment: comment as unknown as ActivityItem['comment'],
          created_at: comment.scheduled_at as number,
        });
      }
    }
  }

  // 2. Hot posts in communities user has visited
  const visitedCommunities = (db.prepare(`
    SELECT DISTINCT target_id FROM user_activity
    WHERE user_id = ? AND action_type = 'visit_community' AND created_at > ?
    LIMIT 10
  `).all(userId, sevenDaysAgo) as Array<{ target_id: number }>).map((r) => r.target_id);

  if (visitedCommunities.length > 0) {
    const placeholders = visitedCommunities.map(() => '?').join(',');
    const hotPosts = db.prepare(`
      ${feedQuery(now)} AND p.community_id IN (${placeholders})
        AND p.scheduled_at > ? AND p.scheduled_at <= ?
        AND p.score > 50
      ORDER BY p.score DESC
      LIMIT 10
    `).all(...visitedCommunities, oneDayAgo, now) as FeedPost[];

    for (const post of hotPosts) {
      items.push({
        id: `hot_in_community_${post.id}`,
        reason: 'hot_in_community',
        post,
        created_at: post.scheduled_at,
      });
    }
  }

  // 3. Viral posts the user previously viewed
  const viewedPostIds = (db.prepare(`
    SELECT DISTINCT target_id FROM user_activity
    WHERE user_id = ? AND action_type IN ('view_post', 'dwell') AND created_at > ?
    LIMIT 50
  `).all(userId, sevenDaysAgo) as Array<{ target_id: number }>).map((r) => r.target_id);

  if (viewedPostIds.length > 0) {
    const placeholders = viewedPostIds.map(() => '?').join(',');
    const viralPosts = db.prepare(`
      ${feedQuery(now)} AND p.id IN (${placeholders}) AND p.score > 200
      ORDER BY p.score DESC
      LIMIT 5
    `).all(...viewedPostIds) as FeedPost[];

    for (const post of viralPosts) {
      if (!items.some((i) => i.post?.id === post.id)) {
        items.push({
          id: `viral_viewed_${post.id}`,
          reason: 'viral_viewed',
          post,
          created_at: post.scheduled_at,
        });
      }
    }
  }

  // Sort by recency
  items.sort((a, b) => b.created_at - a.created_at);

  res.json({ items: items.slice(0, 50) });
});

export default router;
