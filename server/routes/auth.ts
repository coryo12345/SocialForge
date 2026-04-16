import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import type { User } from '../../shared/types.js';

const router = Router();

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

router.post('/login', (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username?.trim()) {
    res.status(400).json({ error: 'Username required' });
    return;
  }

  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!clean) {
    res.status(400).json({ error: 'Invalid username' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(clean) as User | undefined;

  if (!user) {
    const result = db
      .prepare(
        `INSERT INTO users (username, display_name, avatar_seed, is_real_user, karma, created_at)
         VALUES (?, ?, ?, 1, 0, ?)`,
      )
      .run(clean, username.trim(), randomHex(4), now);
    user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(result.lastInsertRowid) as User;
  }

  const sessionId = uuidv4();
  const expiresAt = now + 30 * 24 * 60 * 60;
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, user.id, now, now, expiresAt);

  res.cookie('sf_sid', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({ user, sessionId });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies?.sf_sid as string | undefined;
  if (sid) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  }
  res.clearCookie('sf_sid');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

export default router;
