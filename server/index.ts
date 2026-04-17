import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { sessionMiddleware } from './middleware/session.js';
import authRouter from './routes/auth.js';
import feedRouter from './routes/feed.js';
import communitiesRouter from './routes/communities.js';
import postsRouter from './routes/posts.js';
import commentsRouter from './routes/comments.js';
import usersRouter from './routes/users.js';
import internalRouter from './routes/internal.js';
import settingsRouter from './routes/settings.js';
import searchRouter from './routes/search.js';
import activityRouter from './routes/activity.js';
import { startScoreUpdater } from './jobs/scoreUpdater.js';

// Initialize DB (runs migrations on import — must be imported after config)
import './db.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CORS — allow comma-separated origins
const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain' }));
app.use(cookieParser());
app.use(sessionMiddleware);

// Rate limiters
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true });
const voteLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true });

// Internal auth middleware — no rate limiting for scripts
function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-internal-key'];
  if (key !== config.INTERNAL_API_KEY) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

// Mount internal routes BEFORE api limiter
app.use('/api/internal', requireInternalKey, internalRouter);

// Apply general rate limiter to all other /api/* routes
app.use('/api', apiLimiter);

// Apply vote rate limiter to vote endpoints
app.use('/api/posts/:id/vote', voteLimiter);
app.use('/api/posts/:id/comments/:commentId/vote', voteLimiter);

// Route mounting
app.use('/api/auth', authRouter);
app.use('/api/feed', feedRouter);
app.use('/api/communities', communitiesRouter);
app.use('/api/posts', postsRouter);
app.use('/api', commentsRouter);   // comments router uses /posts/:id/comments paths
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/search', searchRouter);
app.use('/api/activity', activityRouter);

// Production: serve client static files
if (config.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Global error handler (Express 5 — catches thrown errors from async handlers)
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal Server Error' });
});

app.listen(parseInt(config.PORT), '0.0.0.0', () => {
  console.log(`SocialForge server listening on http://0.0.0.0:${config.PORT}`);
  startScoreUpdater();
});
