import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function createDb(dbPath: string) {
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  return drizzle(raw, { schema });
}

export type StoaDb = ReturnType<typeof createDb>;

export { schema };
