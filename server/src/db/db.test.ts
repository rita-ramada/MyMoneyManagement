import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { getSetting, listCategories, setSetting } from './repo';

describe('openDb', () => {
  it('creates all tables', () => {
    const db = openDb(':memory:');
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of [
      'accounts', 'bank_profiles', 'categories', 'transactions', 'rules', 'import_batches',
      'holdings', 'holding_contributions', 'holding_valuations', 'settings', 'migrations',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('running migrations twice is a no-op', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-db-'));
    const file = path.join(dir, 'test.db');
    try {
      openDb(file).close();
      const db = openDb(file);
      const row = db.prepare('SELECT count(*) AS n FROM migrations').get() as { n: number };
      expect(row.n).toBe(1);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds the default categories', () => {
    const db = openDb(':memory:');
    const cats = listCategories(db);
    const byKind = (k: string) => cats.filter((c) => c.kind === k).map((c) => c.name);
    expect(byKind('expense')).toEqual([
      'Groceries', 'Rent/Housing', 'Utilities', 'Transport', 'Subscriptions', 'Eating Out',
      'Shopping', 'Health', 'Leisure', 'Travel', 'Fees', 'Other',
    ]);
    expect(byKind('income')).toEqual(['Salary', 'Other Income']);
    expect(byKind('transfer')).toEqual(['Transfer', 'Investing']);
  });

  it('seeds settings and supports get/set', () => {
    const db = openDb(':memory:');
    expect(getSetting(db, 'transferPatterns', [])).toEqual([
      'TRF', 'TRANSF', 'MB WAY', 'MBWAY', 'SEPA', 'TRANSFERENCIA',
    ]);
    expect(getSetting(db, 'aiEnabled', false)).toBe(true);
    expect(getSetting(db, 'missing', 42)).toBe(42);
    setSetting(db, 'aiEnabled', false);
    expect(getSetting(db, 'aiEnabled', true)).toBe(false);
  });
});
