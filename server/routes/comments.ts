import { Router } from 'express';
import db from '../db.js';
import type { CommentWithAuthor, VoteValue } from '../../shared/types.js';

const router = Router();

router.get('/posts/:id/comments', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const postId = parseInt(req.params.id);
  const sort = (req.query.sort as string) || 'best';

  const comments = db
    .prepare(
      `SELECT
         c.*,
         u.username     AS author_username,
         u.display_name AS author_display_name,
         u.avatar_seed  AS author_avatar_seed
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ? AND c.scheduled_at <= ? AND c.is_removed = 0`,
    )
    .all(postId, now) as CommentWithAuthor[];

  if (sort === 'new') {
    comments.sort((a, b) => b.scheduled_at - a.scheduled_at);
  } else if (sort === 'old') {
    comments.sort((a, b) => a.scheduled_at - b.scheduled_at);
  } else if (sort === 'controversial') {
    comments.sort(
      (a, b) =>
        (b.upvote_count + b.downvote_count) / Math.abs(b.score + 1) -
        (a.upvote_count + a.downvote_count) / Math.abs(a.score + 1),
    );
  } else {
    // best — sort by score within each depth level (tree builder will handle nesting)
    comments.sort((a, b) => b.score - a.score);
  }

  res.json(comments);
});

router.post('/posts/:id/comments', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Login required to comment' });
    return;
  }

  const postId = parseInt(req.params.id);
  const { body, parent_id } = req.body as { body?: string; parent_id?: number };

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'Comment body is required' });
    return;
  }
  if (body.length > 10000) {
    res.status(400).json({ error: 'Comment must be 10,000 characters or fewer' });
    return;
  }

  const post = db
    .prepare('SELECT id FROM posts WHERE id = ? AND is_removed = 0')
    .get(postId) as { id: number } | undefined;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  let depth = 0;
  if (parent_id) {
    const parent = db
      .prepare('SELECT depth FROM comments WHERE id = ? AND post_id = ?')
      .get(parent_id, postId) as { depth: number } | undefined;
    if (!parent) {
      res.status(404).json({ error: 'Parent comment not found' });
      return;
    }
    depth = parent.depth + 1;
  }

  const now = Math.floor(Date.now() / 1000);

  const insertComment = db.prepare(
    `INSERT INTO comments (post_id, parent_id, user_id, body, score, upvote_count, downvote_count, depth, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`,
  );

  const doInsert = db.transaction(() => {
    const result = insertComment.run(
      postId,
      parent_id ?? null,
      req.user!.id,
      body.trim(),
      depth,
      now,
      now,
      now,
    ) as { lastInsertRowid: number };

    db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(postId);
    db.prepare('UPDATE users SET comment_count = comment_count + 1 WHERE id = ?').run(req.user!.id);

    return result.lastInsertRowid;
  });

  const newId = doInsert();

  const comment = db
    .prepare(
      `SELECT c.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_seed AS author_avatar_seed
       FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`,
    )
    .get(newId) as CommentWithAuthor;

  res.status(201).json(comment);
});

const getCommentVote = db.prepare(
  `SELECT value FROM votes WHERE user_id = ? AND target_id = ? AND target_type = 'comment'`,
);

const upsertCommentVote = db.prepare(
  `INSERT INTO votes (user_id, target_id, target_type, value, created_at)
   VALUES (?, ?, 'comment', ?, ?)
   ON CONFLICT(user_id, target_id, target_type) DO UPDATE SET value = excluded.value`,
);

const updateComment = db.prepare(
  `UPDATE comments
   SET upvote_count   = upvote_count   + ?,
       downvote_count = downvote_count + ?,
       score          = score          + ? - ?
   WHERE id = ?`,
);

const doCommentVote = db.transaction(
  (userId: number, commentId: number, newValue: VoteValue, oldValue: VoteValue) => {
    const upDelta = (newValue === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
    const downDelta = (newValue === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);
    const now = Math.floor(Date.now() / 1000);
    upsertCommentVote.run(userId, commentId, newValue, now);
    updateComment.run(upDelta, downDelta, upDelta, downDelta, commentId);
  },
);

router.post('/posts/:id/comments/:commentId/vote', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Login required to vote' });
    return;
  }

  const commentId = parseInt(req.params.commentId);
  const { value } = req.body as { value?: VoteValue };
  if (value === undefined || ![-1, 0, 1].includes(value)) {
    res.status(400).json({ error: 'value must be -1, 0, or 1' });
    return;
  }

  const existing = getCommentVote.get(req.user.id, commentId) as
    | { value: VoteValue }
    | undefined;
  const oldValue: VoteValue = existing?.value ?? 0;

  if (oldValue === value) {
    res.json({ ok: true });
    return;
  }

  doCommentVote(req.user.id, commentId, value, oldValue);

  const updated = db
    .prepare('SELECT score, upvote_count, downvote_count FROM comments WHERE id = ?')
    .get(commentId) as
    | { score: number; upvote_count: number; downvote_count: number }
    | undefined;

  res.json({ ok: true, ...updated });
});

export default router;
