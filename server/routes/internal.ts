import { Router } from 'express';
import db from '../db.js';

const router = Router();

// POST /api/internal/users/bulk
router.post('/users/bulk', (req, res) => {
  const { users } = req.body as { users: Record<string, unknown>[] };
  if (!Array.isArray(users) || users.length === 0) {
    res.status(400).json({ error: 'users array required' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO users
       (username, display_name, avatar_seed, bio, age, location, occupation,
        personality, communication_style, interests, political_lean,
        is_real_user, karma, created_at)
     VALUES
       (@username, @display_name, @avatar_seed, @bio, @age, @location, @occupation,
        @personality, @communication_style, @interests, @political_lean,
        0, 0, @created_at)`,
  );

  const userDefaults = {
    bio: null, age: null, location: null, occupation: null,
    personality: null, communication_style: null, interests: null, political_lean: null,
  };

  const bulkInsert = db.transaction((rows: Record<string, unknown>[]) => {
    let count = 0;
    for (const row of rows) {
      const result = insert.run({ ...userDefaults, ...row, created_at: now });
      count += result.changes;
    }
    return count;
  });

  const count = bulkInsert(users);
  res.json({ inserted: count });
});

// POST /api/internal/communities/bulk
router.post('/communities/bulk', (req, res) => {
  const { communities } = req.body as { communities: Record<string, unknown>[] };
  if (!Array.isArray(communities) || communities.length === 0) {
    res.status(400).json({ error: 'communities array required' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO communities
       (name, display_name, description, sidebar_text, icon_seed,
        banner_color, rules, tags, member_count, post_style_prompt, is_narrative, created_at)
     VALUES
       (@name, @display_name, @description, @sidebar_text, @icon_seed,
        @banner_color, @rules, @tags, @member_count, @post_style_prompt, @is_narrative, @created_at)`,
  );

  const communityDefaults = {
    description: null, sidebar_text: null, rules: null, tags: null,
    banner_color: '#c4730a', member_count: 0, post_style_prompt: null, is_narrative: 0,
  };

  const bulkInsert = db.transaction((rows: Record<string, unknown>[]) => {
    let count = 0;
    for (const row of rows) {
      const result = insert.run({ ...communityDefaults, ...row, created_at: now });
      count += result.changes;
    }
    return count;
  });

  const count = bulkInsert(communities);
  res.json({ inserted: count });
});

// POST /api/internal/posts/bulk
router.post('/posts/bulk', (req, res) => {
  const { posts } = req.body as {
    posts: Array<{
      community_name: string;
      username: string;
      title: string;
      body?: string;
      post_type?: string;
      link_url?: string;
      score?: number;
      upvote_count?: number;
      downvote_count?: number;
      flair?: string | null;
      scheduled_at: number;
      created_at: number;
      updated_at: number;
    }>;
  };

  if (!Array.isArray(posts) || posts.length === 0) {
    res.status(400).json({ error: 'posts array required' });
    return;
  }

  const getCommunity = db.prepare('SELECT id FROM communities WHERE name = ?');
  const getUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const insert = db.prepare(
    `INSERT INTO posts
       (community_id, user_id, title, body, post_type, link_url,
        score, upvote_count, downvote_count, flair,
        scheduled_at, created_at, updated_at)
     VALUES
       (@community_id, @user_id, @title, @body, @post_type, @link_url,
        @score, @upvote_count, @downvote_count, @flair,
        @scheduled_at, @created_at, @updated_at)`,
  );

  const updateUserPostCount = db.prepare(
    'UPDATE users SET post_count = post_count + 1 WHERE id = ?',
  );

  const bulkInsert = db.transaction(
    (
      rows: typeof posts,
    ) => {
      let count = 0;
      for (const row of rows) {
        const community = getCommunity.get(row.community_name) as { id: number } | undefined;
        const user = getUser.get(row.username) as { id: number } | undefined;
        if (!community || !user) continue;

        const score = row.score ?? 0;
        const upvote_count = row.upvote_count ?? score;
        const downvote_count = row.downvote_count ?? 0;

        insert.run({
          community_id: community.id,
          user_id: user.id,
          title: row.title,
          body: row.body ?? null,
          post_type: row.post_type ?? 'text',
          link_url: row.link_url ?? null,
          score,
          upvote_count,
          downvote_count,
          flair: row.flair ?? null,
          scheduled_at: row.scheduled_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
        updateUserPostCount.run(user.id);
        count++;
      }
      return count;
    },
  );

  const count = bulkInsert(posts);
  res.json({ inserted: count });
});

// POST /api/internal/comments/bulk
router.post('/comments/bulk', (req, res) => {
  const { comments } = req.body as {
    comments: Array<{
      post_id: number;
      temp_id?: number | null;
      parent_id?: number | null;
      username: string;
      body: string;
      score?: number;
      upvote_count?: number;
      downvote_count?: number;
      depth?: number;
      scheduled_at: number;
      created_at: number;
      updated_at: number;
    }>;
  };

  if (!Array.isArray(comments) || comments.length === 0) {
    res.status(400).json({ error: 'comments array required' });
    return;
  }

  const getUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const insert = db.prepare(
    `INSERT INTO comments
       (post_id, parent_id, user_id, body, score, upvote_count, downvote_count,
        depth, scheduled_at, created_at, updated_at)
     VALUES
       (@post_id, @parent_id, @user_id, @body, @score, @upvote_count, @downvote_count,
        @depth, @scheduled_at, @created_at, @updated_at)`,
  );
  const updatePostCount = db.prepare(
    'UPDATE posts SET comment_count = comment_count + ? WHERE id = ?',
  );
  const updateUserCount = db.prepare(
    'UPDATE users SET comment_count = comment_count + ? WHERE id = ?',
  );

  const bulkInsert = db.transaction((rows: typeof comments) => {
    const countByPost = new Map<number, number>();
    const countByUser = new Map<number, number>();
    const tempIdMap = new Map<number, number>(); // temp_id → real db id
    let count = 0;
    for (const row of rows) {
      const user = getUser.get(row.username) as { id: number } | undefined;
      if (!user) continue;

      const rawParentId = row.parent_id ?? null;
      const resolvedParentId =
        rawParentId !== null && tempIdMap.has(rawParentId)
          ? tempIdMap.get(rawParentId)!
          : null;

      const score = row.score ?? 0;
      const result = insert.run({
        post_id: row.post_id,
        parent_id: resolvedParentId,
        user_id: user.id,
        body: row.body,
        score,
        upvote_count: row.upvote_count ?? score,
        downvote_count: row.downvote_count ?? 0,
        depth: row.depth ?? 0,
        scheduled_at: row.scheduled_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
      if (row.temp_id != null) {
        tempIdMap.set(row.temp_id, result.lastInsertRowid as number);
      }
      countByPost.set(row.post_id, (countByPost.get(row.post_id) ?? 0) + 1);
      countByUser.set(user.id, (countByUser.get(user.id) ?? 0) + 1);
      count++;
    }
    for (const [postId, c] of countByPost) updatePostCount.run(c, postId);
    for (const [userId, c] of countByUser) updateUserCount.run(c, userId);
    return count;
  });

  const count = bulkInsert(comments);
  res.json({ inserted: count });
});

// GET /api/internal/users/random
router.get('/users/random', (req, res) => {
  const count = Math.min(parseInt(req.query.count as string) || 1, 50);
  const users = db
    .prepare('SELECT * FROM users WHERE is_real_user = 0 ORDER BY RANDOM() LIMIT ?')
    .all(count);
  res.json(users);
});

// GET /api/internal/posts/recent
router.get('/posts/recent', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const posts = db
    .prepare(
      `SELECT p.*, c.name AS community_name, u.username AS author_username
       FROM posts p
       JOIN communities c ON p.community_id = c.id
       JOIN users u ON p.user_id = u.id
       WHERE p.scheduled_at <= ? AND p.is_removed = 0
       ORDER BY p.scheduled_at DESC LIMIT ?`,
    )
    .all(now, limit);
  res.json(posts);
});

export default router;
