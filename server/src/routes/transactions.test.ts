import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Transaction } from '@mmm/shared/src/types';
import { createApp } from '../app';
import type { AiCategorizer, AiItem } from '../categorize/ai';
import { merchantKey } from '../categorize/text';
import { openDb } from '../db/db';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;
let aiCalls: AiItem[][];
const catId = (name: string) => (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
const rules = () => db.prepare('SELECT merchant_key AS k, category_id AS c FROM rules').all() as { k: string; c: number }[];

beforeEach(() => {
  db = openDb(':memory:');
  aiCalls = [];
  const ai: AiCategorizer = {
    async categorize(items) {
      aiCalls.push(items);
      return new Map();
    },
  };
  app = createApp({ db, ai });
  db.prepare("INSERT INTO accounts (name, opening_balance_cents, opening_balance_date) VALUES ('Main', 0, '2026-01-01')").run();
  db.prepare("INSERT INTO accounts (name, opening_balance_cents, opening_balance_date) VALUES ('Other', 0, '2026-01-01')").run();
});

const post = (body: object) => request(app).post('/api/transactions').send(body);
const base = { accountId: 1, date: '2026-03-05', description: 'CONTINENTE 123', amountCents: -5420, categoryId: null };

describe('POST /api/transactions', () => {
  test('creates a manual entry, upserts the rule, never calls the AI', async () => {
    const res = await post({ ...base, categoryId: catId('Groceries') });
    expect(res.status).toBe(201);
    const t = res.body as Transaction;
    expect(t).toMatchObject({ origin: 'manual', categorySource: 'manual', importBatchId: null });
    expect(rules()).toEqual([{ k: merchantKey('CONTINENTE 123'), c: catId('Groceries') }]);
    expect(aiCalls).toEqual([]);
  });

  test("source is 'rule' when the category equals the rule suggestion", async () => {
    await post({ ...base, categoryId: catId('Groceries') });
    const res = await post({ ...base, date: '2026-03-06', categoryId: catId('Groceries') });
    expect(res.body.categorySource).toBe('rule');
  });

  test('uncategorized entry has source none and creates no rule', async () => {
    const res = await post(base);
    expect(res.body).toMatchObject({ categoryId: null, categorySource: 'none' });
    expect(rules()).toEqual([]);
  });

  test('never upserts a rule for an empty merchant key', async () => {
    const res = await post({ ...base, description: '12345 99', categoryId: catId('Groceries') });
    expect(res.status).toBe(201);
    expect(rules()).toEqual([]);
  });

  test('validation and unknown references', async () => {
    expect((await post({ ...base, date: '2026-02-31' })).status).toBe(400);
    expect((await post({ ...base, amountCents: 1.5 })).status).toBe(400);
    expect((await post({ ...base, categoryId: 9999 })).status).toBe(400);
    expect((await post({ ...base, accountId: 9999 })).status).toBe(404);
  });
});

describe('PATCH /api/transactions/:id', () => {
  const seed = async () => {
    const a = (await post({ ...base })).body as Transaction;
    const b = (await post({ ...base, date: '2026-03-06' })).body as Transaction;
    return { a, b };
  };

  test('category change affects only that row and updates the rule', async () => {
    const { a, b } = await seed();
    const res = await request(app).patch(`/api/transactions/${a.id}`).send({ categoryId: catId('Groceries') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: a.id, categoryId: catId('Groceries'), categorySource: 'manual' });
    const other = (await request(app).get('/api/transactions').query({ categoryId: 'none' })).body as Transaction[];
    expect(other.map((t) => t.id)).toEqual([b.id]);
    expect(rules()).toEqual([{ k: merchantKey('CONTINENTE 123'), c: catId('Groceries') }]);
    // Changing again updates the existing rule.
    const other2 = catId('Transport');
    await request(app).patch(`/api/transactions/${a.id}`).send({ categoryId: other2 });
    expect(rules()).toEqual([{ k: merchantKey('CONTINENTE 123'), c: other2 }]);
  });

  test('null category resets to none without touching rules', async () => {
    const { a } = await seed();
    await request(app).patch(`/api/transactions/${a.id}`).send({ categoryId: catId('Groceries') });
    const res = await request(app).patch(`/api/transactions/${a.id}`).send({ categoryId: null });
    expect(res.body).toMatchObject({ categoryId: null, categorySource: 'none' });
    expect(rules()).toHaveLength(1);
  });

  test('description change recomputes merchantKey and dedupeHash', async () => {
    const { a } = await seed();
    const res = await request(app).patch(`/api/transactions/${a.id}`).send({ description: 'PINGO DOCE 55' });
    expect(res.body.merchantKey).toBe(merchantKey('PINGO DOCE 55'));
    expect(res.body.merchantKey).not.toBe(a.merchantKey);
    expect(res.body.dedupeHash).not.toBe(a.dedupeHash);
  });

  test('404 and 400', async () => {
    const { a } = await seed();
    expect((await request(app).patch('/api/transactions/9999').send({})).status).toBe(404);
    expect((await request(app).patch(`/api/transactions/${a.id}`).send({ date: 'nope' })).status).toBe(400);
    expect((await request(app).patch(`/api/transactions/${a.id}`).send({ categoryId: 9999 })).status).toBe(400);
  });
});

describe('DELETE /api/transactions/:id', () => {
  test('204 then 404', async () => {
    const t = (await post(base)).body as Transaction;
    expect((await request(app).delete(`/api/transactions/${t.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/transactions/${t.id}`)).status).toBe(404);
  });
});

describe('GET /api/transactions and export', () => {
  beforeEach(async () => {
    await post({ ...base, categoryId: catId('Groceries') });
    await post({ accountId: 2, date: '2026-04-01', description: 'Café Central', amountCents: -300, categoryId: null });
    await post({ accountId: 1, date: '2026-04-10', description: 'SALARY; "ACME"', amountCents: 150000, categoryId: null });
  });

  test('newest first and filters', async () => {
    const all = (await request(app).get('/api/transactions')).body as Transaction[];
    expect(all.map((t) => t.date)).toEqual(['2026-04-10', '2026-04-01', '2026-03-05']);
    const get = async (q: object) => ((await request(app).get('/api/transactions').query(q)).body as Transaction[]).length;
    expect(await get({ accountId: 2 })).toBe(1);
    expect(await get({ month: '2026-04' })).toBe(2);
    expect(await get({ q: 'CAFÉ' })).toBe(1);
    expect(await get({ q: 'continente' })).toBe(1);
    expect(await get({ categoryId: catId('Groceries') })).toBe(1);
    expect(await get({ categoryId: 'none' })).toBe(2);
    expect(await get({ uncategorized: '1' })).toBe(2);
  });

  test('categoryId=none returns only uncategorized rows', async () => {
    const rows = (await request(app).get('/api/transactions').query({ categoryId: 'none' })).body as Transaction[];
    expect(rows.every((t) => t.categoryId === null)).toBe(true);
  });

  test('invalid query params are 400', async () => {
    expect((await request(app).get('/api/transactions').query({ month: '2026-13' })).status).toBe(400);
    expect((await request(app).get('/api/transactions').query({ accountId: 'x' })).status).toBe(400);
    expect((await request(app).get('/api/export/transactions.csv').query({ month: 'bad' })).status).toBe(400);
  });

  test('export CSV: headers, columns, amounts, quoting, filters', async () => {
    const res = await request(app).get('/api/export/transactions.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="transactions.csv"');
    expect(res.text).toBe(
      '﻿Date;Account;Description;Amount;Category\r\n' +
        '2026-04-10;Main;"SALARY; ""ACME""";1500,00;\r\n' +
        '2026-04-01;Other;Café Central;-3,00;\r\n' +
        '2026-03-05;Main;CONTINENTE 123;-54,20;Groceries\r\n',
    );
    const filtered = await request(app).get('/api/export/transactions.csv').query({ accountId: 1, month: '2026-03' });
    expect(filtered.text).toBe(
      '﻿Date;Account;Description;Amount;Category\r\n2026-03-05;Main;CONTINENTE 123;-54,20;Groceries\r\n',
    );
  });
  test('export CSV neutralises formula injection in text cells', async () => {
    await post({ accountId: 1, date: '2026-05-01', description: '=HYPERLINK("x")', amountCents: -100, categoryId: null });
    const res = await request(app).get('/api/export/transactions.csv').query({ month: '2026-05' });
    expect(res.text).toBe(
      '\uFEFFDate;Account;Description;Amount;Category\r\n' + `2026-05-01;Main;"'=HYPERLINK(""x"")";-1,00;\r\n`,
    );
  });
});

describe('PATCH with an unchanged category (final review I3)', () => {
  test('re-sending the same category keeps its source and does not rewrite the rule', async () => {
    // Rule says CONTINENTE → Groceries; an older row was put in Shopping by the AI.
    await post({ ...base, categoryId: catId('Groceries') });
    db.prepare("UPDATE transactions SET category_id = ?, category_source = 'ai' WHERE id = 1").run(catId('Shopping'));
    const res = await request(app).patch('/api/transactions/1').send({ date: '2026-03-06', categoryId: catId('Shopping') });
    expect(res.status).toBe(200);
    expect(res.body.categorySource).toBe('ai');
    expect(res.body.date).toBe('2026-03-06');
    expect(rules()).toEqual([{ k: 'CONTINENTE', c: catId('Groceries') }]);
  });
});
