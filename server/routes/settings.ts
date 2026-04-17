import { Router } from 'express';
import db from '../db.js';

interface SettingRow {
  key: string;
  value: string;
  label: string;
  description: string | null;
  category: string;
  type: string;
}

const router = Router();

// GET /api/settings/schema — must be before /:key
router.get('/schema', (_req, res) => {
  const rows = db.prepare('SELECT * FROM settings ORDER BY category, key').all() as SettingRow[];
  res.json(rows);
});

// GET /api/settings — flat { key: value } object
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

// GET /api/settings/:key
router.get('/:key', (req, res) => {
  const row = db
    .prepare('SELECT * FROM settings WHERE key = ?')
    .get(req.params.key) as SettingRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Setting not found' });
    return;
  }
  res.json(row);
});

// PUT /api/settings — bulk update
router.put('/', (req, res) => {
  const { settings } = req.body as { settings?: Record<string, string> };
  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ error: 'Body must be { settings: { key: value } }' });
    return;
  }
  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  const updateMany = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) update.run(String(value), key);
  });
  updateMany(Object.entries(settings));
  res.json({ ok: true });
});

// PUT /api/settings/:key
router.put('/:key', (req, res) => {
  const row = db
    .prepare('SELECT type FROM settings WHERE key = ?')
    .get(req.params.key) as { type: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Setting not found' });
    return;
  }
  const { value } = req.body as { value?: unknown };
  if (value === undefined) {
    res.status(400).json({ error: 'Body must include value' });
    return;
  }
  // Basic type validation
  const v = String(value);
  if (row.type === 'number' && isNaN(Number(v))) {
    res.status(400).json({ error: 'Value must be a number' });
    return;
  }
  if (row.type === 'boolean' && v !== 'true' && v !== 'false') {
    res.status(400).json({ error: 'Value must be true or false' });
    return;
  }
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(v, req.params.key);
  res.json({ ok: true, key: req.params.key, value: v });
});

export default router;
