import type { Database } from 'better-sqlite3';
import type { Category } from '@mmm/shared/src/types';

export function listCategories(db: Database): Category[] {
  return db.prepare('SELECT id, name, kind FROM categories ORDER BY id').all() as Category[];
}

export function getSetting<T>(db: Database, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: Database, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}
