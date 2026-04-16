import { Router } from 'express';
import db from '../db.js';
import type { CommentWithAuthor, VoteValue } from '../../shared/types.js';

const router = Router();

router.get('/posts/:id/comments', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const postId = parseInt(req.params.id);

  const comments = db
    .prepare(
      `SELECT
         c.*,
         u.username     AS author_username,
         u.display_name AS author_display_name,
         u.avatar_seed  AS author_avatar_seed
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ? AND c.scheduled_at <= ? AND c.is_removed = 0
       ORDER BY c.depth ASC, c.score DESC`,
    )
    .all(postId, now) as CommentWithAuthor[];

  res.json(comments);
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
