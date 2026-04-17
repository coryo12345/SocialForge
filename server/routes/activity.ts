import { Router } from 'express';
import db from '../db.js';

const router = Router();

// POST /api/activity — fire-and-forget activity tracking
router.post('/', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let body = req.body as Record<string, unknown>;

  // sendBeacon sends Content-Type: text/plain; parse manually
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { res.sendStatus(400); return; }
  }

  const { action_type, target_id, target_type, metadata } = body;

  const validActions = ['view_post', 'visit_community', 'upvote', 'downvote', 'dwell'];
  const validTargets = ['post', 'community', 'user'];

  if (
    typeof action_type !== 'string' || !validActions.includes(action_type) ||
    typeof target_id !== 'number' ||
    typeof target_type !== 'string' || !validTargets.includes(target_type)
  ) {
    res.sendStatus(400);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO user_activity (user_id, action_type, target_id, target_type, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    req.user.id,
    action_type,
    target_id,
    target_type,
    metadata ? JSON.stringify(metadata) : null,
    now,
  );

  res.sendStatus(204);
});

export default router;
