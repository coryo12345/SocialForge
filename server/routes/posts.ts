import { Router } from 'express';
import db from '../db.js';
import type { FeedPost, VoteValue } from '../../shared/types.js';

const router = Router();

function postDetailQuery(now: number) {
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
    WHERE p.id = ? AND p.is_removed = 0 AND p.scheduled_at <= ?
  `;
}

router.get('/:id', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const post = db
    .prepare(postDetailQuery(now))
    .get(parseInt(req.params.id), now) as FeedPost | undefined;

  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  res.json(post);
});

const getVote = db.prepare(
  `SELECT value FROM votes WHERE user_id = ? AND target_id = ? AND target_type = 'post'`,
);

const upsertVote = db.prepare(
  `INSERT INTO votes (user_id, target_id, target_type, value, created_at)
   VALUES (?, ?, 'post', ?, ?)
   ON CONFLICT(user_id, target_id, target_type) DO UPDATE SET value = excluded.value`,
);

const updatePost = db.prepare(
  `UPDATE posts
   SET upvote_count   = upvote_count   + ?,
       downvote_count = downvote_count + ?,
       score          = score          + ? - ?
   WHERE id = ?`,
);

const doVote = db.transaction(
  (userId: number, postId: number, newValue: VoteValue, oldValue: VoteValue) => {
    const upDelta = (newValue === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
    const downDelta = (newValue === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);
    const now = Math.floor(Date.now() / 1000);
    upsertVote.run(userId, postId, newValue, now);
    updatePost.run(upDelta, downDelta, upDelta, downDelta, postId);
  },
);

router.post('/:id/vote', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Login required to vote' });
    return;
  }

  const postId = parseInt(req.params.id);
  const { value } = req.body as { value?: VoteValue };
  if (value === undefined || ![-1, 0, 1].includes(value)) {
    res.status(400).json({ error: 'value must be -1, 0, or 1' });
    return;
  }

  const existing = getVote.get(req.user.id, postId) as { value: VoteValue } | undefined;
  const oldValue: VoteValue = existing?.value ?? 0;

  if (oldValue === value) {
    // No change
    res.json({ ok: true });
    return;
  }

  doVote(req.user.id, postId, value, oldValue);

  const updated = db
    .prepare('SELECT score, upvote_count, downvote_count FROM posts WHERE id = ?')
    .get(postId) as { score: number; upvote_count: number; downvote_count: number } | undefined;

  res.json({ ok: true, ...updated });
});

export default router;
