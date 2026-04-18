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
        personality, writing_style, interests, political_lean,
        is_real_user, karma, created_at)
     VALUES
       (@username, @display_name, @avatar_seed, @bio, @age, @location, @occupation,
        @personality, @writing_style, @interests, @political_lean,
        0, 0, @created_at)`,
  );

  const userDefaults = {
    bio: null, age: null, location: null, occupation: null,
    personality: null, writing_style: null,
    interests: null, political_lean: null,
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

// GET /api/internal/users/all — all AI users (for generate_relationships.py)
router.get('/users/all', (req, res) => {
  const users = db
    .prepare('SELECT * FROM users WHERE is_real_user = 0 ORDER BY id')
    .all();
  res.json(users);
});

// GET /api/internal/users/:user_id/posts
router.get('/users/:user_id/posts', (req, res) => {
  const userId = parseInt(req.params.user_id);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const posts = db
    .prepare(
      `SELECT p.id, p.title, p.body, p.score, p.scheduled_at,
              c.name AS community_name
       FROM posts p
       JOIN communities c ON p.community_id = c.id
       WHERE p.user_id = ? AND p.is_removed = 0
       ORDER BY p.scheduled_at DESC LIMIT ?`,
    )
    .all(userId, limit);
  res.json(posts);
});

// GET /api/internal/users/:user_id/comments
router.get('/users/:user_id/comments', (req, res) => {
  const userId = parseInt(req.params.user_id);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.score, c.scheduled_at,
              comm.name AS community_name,
              p.title AS post_title
       FROM comments c
       JOIN posts p ON c.post_id = p.id
       JOIN communities comm ON p.community_id = comm.id
       WHERE c.user_id = ? AND c.is_removed = 0
       ORDER BY c.scheduled_at DESC LIMIT ?`,
    )
    .all(userId, limit);
  res.json(comments);
});

// GET /api/internal/relationships?user_id=X
router.get('/relationships', (req, res) => {
  const userId = parseInt(req.query.user_id as string);
  if (isNaN(userId)) {
    res.status(400).json({ error: 'user_id required' });
    return;
  }
  const rows = db
    .prepare(
      `SELECT r.*,
              ua.username AS user_a_username, ua.display_name AS user_a_display_name,
              ub.username AS user_b_username, ub.display_name AS user_b_display_name
       FROM user_relationships r
       JOIN users ua ON r.user_id_a = ua.id
       JOIN users ub ON r.user_id_b = ub.id
       WHERE r.user_id_a = ? OR r.user_id_b = ?`,
    )
    .all(userId, userId);
  res.json(rows);
});

// POST /api/internal/relationships/bulk
router.post('/relationships/bulk', (req, res) => {
  const { relationships } = req.body as {
    relationships: Array<{
      user_id_a: number;
      user_id_b: number;
      relationship_type: string;
      strength: number;
      notes?: string;
    }>;
  };
  if (!Array.isArray(relationships) || relationships.length === 0) {
    res.status(400).json({ error: 'relationships array required' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO user_relationships
       (user_id_a, user_id_b, relationship_type, strength, notes, created_at)
     VALUES (@user_id_a, @user_id_b, @relationship_type, @strength, @notes, @created_at)`,
  );
  const bulkInsert = db.transaction((rows: typeof relationships) => {
    let count = 0;
    for (const row of rows) {
      insert.run({ ...row, notes: row.notes ?? null, created_at: now });
      count++;
    }
    return count;
  });

  const count = bulkInsert(relationships);
  res.json({ inserted: count });
});

// GET /api/internal/memory?user_id=X[&memory_type=Y]
router.get('/memory', (req, res) => {
  const userId = parseInt(req.query.user_id as string);
  if (isNaN(userId)) {
    res.status(400).json({ error: 'user_id required' });
    return;
  }
  const memoryType = req.query.memory_type as string | undefined;
  let rows: unknown[];
  if (memoryType) {
    rows = db
      .prepare(`SELECT * FROM user_memory WHERE user_id = ? AND memory_type = ? ORDER BY updated_at DESC`)
      .all(userId, memoryType);
  } else {
    rows = db
      .prepare(`SELECT * FROM user_memory WHERE user_id = ? ORDER BY memory_type, updated_at DESC`)
      .all(userId);
  }
  res.json(rows);
});

// POST /api/internal/memory/bulk
router.post('/memory/bulk', (req, res) => {
  const { memories } = req.body as {
    memories: Array<{
      user_id: number;
      memory_type: string;
      key: string;
      value: string;
    }>;
  };
  if (!Array.isArray(memories) || memories.length === 0) {
    res.status(400).json({ error: 'memories array required' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const upsert = db.prepare(
    `INSERT INTO user_memory (user_id, memory_type, key, value, created_at, updated_at)
     VALUES (@user_id, @memory_type, @key, @value, @created_at, @updated_at)
     ON CONFLICT(user_id, memory_type, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const bulkUpsert = db.transaction((rows: typeof memories) => {
    let count = 0;
    for (const row of rows) {
      upsert.run({ ...row, created_at: now, updated_at: now });
      count++;
    }
    return count;
  });

  const count = bulkUpsert(memories);
  res.json({ upserted: count });
});

// PATCH /api/internal/users/:id — update writing_style (used by backfill script)
router.patch('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: 'invalid user id' });
    return;
  }
  const { writing_style } = req.body as { writing_style?: string };
  if (!writing_style) {
    res.status(400).json({ error: 'writing_style required' });
    return;
  }
  const result = db.prepare('UPDATE users SET writing_style = ? WHERE id = ?').run(writing_style, id);
  res.json({ updated: result.changes });
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
