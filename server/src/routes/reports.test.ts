import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db/db';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;
let seq = 0;
const catId = (name: string) => (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
const add = (accountId: number, date: string, cents: number, cat: string | null) => {
  seq += 1;
  db.prepare(
    `INSERT INTO transactions (account_id, date, description, merchant_key, amount_cents, category_id, category_source, origin, dedupe_hash)
     VALUES (?, ?, 'd', 'shop', ?, ?, 'manual', 'manual', ?)`,
  ).run(accountId, date, cents, cat ? catId(cat) : null, `h${seq}`);
};

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, ai: null });
  db.prepare("INSERT INTO accounts (name, opening_balance_cents, opening_balance_date) VALUES ('Main', 0, '2026-01-01')").run();
  db.prepare("INSERT INTO accounts (name, opening_balance_cents, opening_balance_date) VALUES ('Other', 0, '2026-01-01')").run();
});

describe('GET /api/reports/spending', () => {
  test('summarises the requested month', async () => {
    add(1, '2026-11-30', -5000, 'Groceries');
    add(1, '2026-10-01', -3000, 'Groceries');
    const res = await request(app).get('/api/reports/spending?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.body.byCategory).toEqual([{ categoryId: catId('Groceries'), name: 'Groceries', cents: 5000, prevCents: 3000 }]);
    expect(res.body.last12).toHaveLength(12);
  });

  test('defaults to the latest month with data, honouring accountId', async () => {
    add(1, '2026-09-10', -100, 'Groceries');
    add(2, '2026-11-10', -900, 'Groceries');
    const all = await request(app).get('/api/reports/spending');
    expect(all.body.month).toBe('2026-11');
    const one = await request(app).get('/api/reports/spending?accountId=1');
    expect(one.body.month).toBe('2026-09');
    expect(one.body.totalExpenseCents).toBe(100);
  });

  test('falls back to the current month when empty', async () => {
    const res = await request(app).get('/api/reports/spending');
    expect(res.body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(res.body.totalExpenseCents).toBe(0);
  });

  test('rejects a bad month', async () => {
    expect((await request(app).get('/api/reports/spending?month=2026-13')).status).toBe(400);
  });
});
