import type { Request, Response, NextFunction } from 'express';
import db from '../db.js';
import type { User } from '../../shared/types.js';

// Augment Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: User | null;
    }
  }
}

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const sid = req.cookies?.sf_sid as string | undefined;
  if (!sid) {
    req.user = null;
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  const session = db
    .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
    .get(sid, now) as { user_id: number } | undefined;

  if (!session) {
    req.user = null;
    return next();
  }

  // Rolling 30-day expiry
  const newExpiry = now + 30 * 24 * 60 * 60;
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
    now,
    newExpiry,
    sid,
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as
    | User
    | undefined;
  req.user = user ?? null;
  next();
}
