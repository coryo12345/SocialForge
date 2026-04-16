import 'dotenv/config';

export const config = {
  PORT: process.env.PORT ?? '3001',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DB_PATH: process.env.DB_PATH ?? '../data/SocialForge.db',
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'dev-session-secret',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};
