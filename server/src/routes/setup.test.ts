import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { merchantKey } from '../categorize/text';
import { openDb } from '../db/db';

const profileBody = {
  name: 'Bank A',
  delimiter: ';',
  skipRows: 0,
  hasHeader: true,
  dateCol: 0,
  descriptionCols: [1],
  amountMode: 'single',
  amountCol: 2,
  debitCol: null,
  creditCol: null,
  dateFormat: 'DD-MM-YYYY',
  decimalSeparator: ',',
  invertSign: false,
};

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, ai: null });
});

describe('accounts', () => {
  const body = { name: 'Main', bankProfileId: null, openingBalanceCents: 12345, openingBalanceDate: '2026-01-01' };

  test('create, list and update round-trip', async () => {
    const created = await request(app).post('/api/accounts').send(body);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: 1, ...body });

    const put = await request(app).put('/api/accounts/1').send({ ...body, name: 'Renamed' });
    expect(put.status).toBe(200);
    expect(put.body.name).toBe('Renamed');

    const list = await request(app).get('/api/accounts');
    expect(list.body).toEqual([{ id: 1, ...body, name: 'Renamed' }]);
  });

  test('missing name returns 400', async () => {
    const { name: _n, ...noName } = body;
    const res = await request(app).post('/api/accounts').send(noName);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('PUT on unknown id returns 404', async () => {
    const res = await request(app).put('/api/accounts/99').send(body);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('bank profiles', () => {
  test('create returns camelCase booleans and arrays', async () => {
    const res = await request(app).post('/api/bank-profiles').send(profileBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, ...profileBody });
    expect((await request(app).get('/api/bank-profiles')).body).toHaveLength(1);
  });

  test("single mode without amountCol returns 400", async () => {
    const res = await request(app).post('/api/bank-profiles').send({ ...profileBody, amountCol: null });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('debitCredit mode requires debitCol and creditCol', async () => {
    const dc = { ...profileBody, amountMode: 'debitCredit', amountCol: null };
    expect((await request(app).post('/api/bank-profiles').send(dc)).status).toBe(400);
    expect((await request(app).post('/api/bank-profiles').send({ ...dc, debitCol: 2 })).status).toBe(400);
    const ok = await request(app).post('/api/bank-profiles').send({ ...dc, debitCol: 2, creditCol: 3 });
    expect(ok.status).toBe(201);
  });

  test('PUT updates and unknown id returns 404', async () => {
    await request(app).post('/api/bank-profiles').send(profileBody);
    const put = await request(app)
      .put('/api/bank-profiles/1')
      .send({ ...profileBody, invertSign: true, descriptionCols: [1, 3] });
    expect(put.body.invertSign).toBe(true);
    expect(put.body.descriptionCols).toEqual([1, 3]);
    expect((await request(app).put('/api/bank-profiles/9').send(profileBody)).status).toBe(404);
    expect((await request(app).delete('/api/bank-profiles/9')).status).toBe(404);
  });

  test("deleting a profile nulls the account's bankProfileId", async () => {
    await request(app).post('/api/bank-profiles').send(profileBody);
    await request(app)
      .post('/api/accounts')
      .send({ name: 'Main', bankProfileId: 1, openingBalanceCents: 0, openingBalanceDate: '2026-01-01' });
    const del = await request(app).delete('/api/bank-profiles/1');
    expect(del.status).toBe(204);
    const accounts = await request(app).get('/api/accounts');
    expect(accounts.body[0].bankProfileId).toBeNull();
    expect((await request(app).get('/api/bank-profiles')).body).toEqual([]);
  });
});

describe('categories', () => {
  test('list includes seeds; create and rename work; duplicate name is 400', async () => {
    const list = await request(app).get('/api/categories');
    expect(list.body.length).toBeGreaterThan(0);
    const created = await request(app).post('/api/categories').send({ name: 'Pets', kind: 'expense' });
    expect(created.status).toBe(201);
    const put = await request(app)
      .put(`/api/categories/${created.body.id}`)
      .send({ name: 'Pet care', kind: 'expense' });
    expect(put.body).toEqual({ id: created.body.id, name: 'Pet care', kind: 'expense' });
    const dup = await request(app).post('/api/categories').send({ name: 'Groceries', kind: 'expense' });
    expect(dup.status).toBe(400);
    expect((await request(app).put('/api/categories/999').send({ name: 'x', kind: 'income' })).status).toBe(404);
    expect((await request(app).post('/api/categories').send({ name: 'x', kind: 'bogus' })).status).toBe(400);
  });
});

describe('rules', () => {
  const insertRule = (key: string, categoryId: number) =>
    db
      .prepare('INSERT INTO rules (merchant_key, category_id, created_at) VALUES (?, ?, ?)')
      .run(key, categoryId, '2026-01-01T00:00:00.000Z');

  test('suggest returns the rule category for a matching merchant key', async () => {
    // merchantKey keeps the standalone "99", so the stored key is "99 CONTINENTE LISBOA".
    const description = 'COMPRA 99 CONTINENTE LISBOA 01/12';
    expect(merchantKey(description)).toBe('99 CONTINENTE LISBOA');
    insertRule(merchantKey(description), 1);
    insertRule('CONTINENTE LISBOA', 2);
    const res = await request(app).get('/api/rules/suggest').query({ description });
    expect(res.body).toEqual({ categoryId: 1 });
    const none = await request(app).get('/api/rules/suggest').query({ description: 'SOMETHING ELSE' });
    expect(none.body).toEqual({ categoryId: null });
  });

  test('suggest with an empty merchant key returns null even if an empty-key rule exists', async () => {
    insertRule('', 1);
    const res = await request(app).get('/api/rules/suggest').query({ description: '12345 99' });
    expect(res.body).toEqual({ categoryId: null });
    expect((await request(app).get('/api/rules/suggest')).body).toEqual({ categoryId: null });
  });

  test('list and delete', async () => {
    insertRule('FOO', 2);
    const list = await request(app).get('/api/rules');
    expect(list.body).toEqual([{ id: 1, merchantKey: 'FOO', categoryId: 2, createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect((await request(app).delete('/api/rules/1')).status).toBe(204);
    expect((await request(app).delete('/api/rules/1')).status).toBe(404);
  });
});

describe('settings', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  test('never exposes the API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const res = await request(app).get('/api/settings');
    expect(JSON.stringify(res.body)).not.toContain('sk-test');
    expect(res.body.aiConfigured).toBe(false);
    expect(res.body.aiEnabled).toBe(true);
    expect(res.body.transferPatterns).toContain('TRF');
  });

  test('aiConfigured reflects whether an AI client is wired', async () => {
    const withAi = createApp({ db, ai: { categorize: async () => [] } as any });
    expect((await request(withAi).get('/api/settings')).body.aiConfigured).toBe(true);
  });

  test('PUT applies a partial update and ignores aiConfigured', async () => {
    const res = await request(app).put('/api/settings').send({ aiEnabled: false, aiConfigured: true });
    expect(res.body).toMatchObject({ aiEnabled: false, aiConfigured: false });
    expect(res.body.transferPatterns).toContain('TRF');
    const res2 = await request(app).put('/api/settings').send({ transferPatterns: ['XFER'] });
    expect(res2.body).toMatchObject({ aiEnabled: false, transferPatterns: ['XFER'] });
    expect((await request(app).put('/api/settings').send({ aiEnabled: 'yes' })).status).toBe(400);
  });
});

describe('backup', () => {
  test('creates a backup file next to a file DB', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-backup-'));
    const fileDb = openDb(path.join(dir, 'finance.db'));
    try {
      const res = await request(createApp({ db: fileDb, ai: null })).post('/api/backup');
      expect(res.status).toBe(200);
      expect(path.isAbsolute(res.body.file)).toBe(true);
      expect(path.dirname(res.body.file)).toBe(path.join(dir, 'backups'));
      expect(path.basename(res.body.file)).toMatch(/^finance-\d{8}-\d{6}\.db$/);
      expect(fs.existsSync(res.body.file)).toBe(true);
    } finally {
      fileDb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('in-memory DB returns 400', async () => {
    const res = await request(app).post('/api/backup');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});
