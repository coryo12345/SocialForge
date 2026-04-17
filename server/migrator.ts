import { Umzug, type UmzugStorage, type MigrationParams } from 'umzug';
import type Database from 'better-sqlite3';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ext = __filename.endsWith('.ts') ? 'ts' : 'js';

type MigrationContext = { db: Database.Database };

class SQLiteStorage implements UmzugStorage<MigrationContext> {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS umzug_migrations (
        name   TEXT PRIMARY KEY,
        run_at TEXT NOT NULL
      )
    `);
  }

  async logMigration({ name }: MigrationParams<MigrationContext>) {
    this.db.prepare('INSERT INTO umzug_migrations (name, run_at) VALUES (?, ?)')
      .run(name, new Date().toISOString());
  }

  async unlogMigration({ name }: MigrationParams<MigrationContext>) {
    this.db.prepare('DELETE FROM umzug_migrations WHERE name = ?').run(name);
  }

  async executed() {
    return (this.db.prepare('SELECT name FROM umzug_migrations ORDER BY name').all() as { name: string }[])
      .map(r => r.name);
  }
}

function createMigrator(db: Database.Database) {
  return new Umzug<MigrationContext>({
    migrations: {
      glob: path.join(__dirname, `migrations/*.${ext}`),
      resolve: ({ name, path: migPath }) => ({
        name,
        up: async (params) => (await import(pathToFileURL(migPath!).href)).up(params),
        down: async (params) => (await import(pathToFileURL(migPath!).href)).down?.(params),
      }),
    },
    context: { db },
    storage: new SQLiteStorage(db),
    logger: console,
  });
}

export type Migration = (params: MigrationParams<MigrationContext>) => Promise<void>;

export async function runMigrations(db: Database.Database): Promise<void> {
  await createMigrator(db).up();
}
