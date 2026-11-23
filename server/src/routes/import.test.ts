import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import type { CommitRow, ImportPreview } from '@mmm/shared/src/types';
import { createApp } from '../app';
import type { AiCategorizer, AiItem } from '../categorize/ai';
import { merchantKey } from '../categorize/text';
import { openDb } from '../db/db';
import { descriptionHash } from '../import/dedupe';

const fixtureBytes = fs.readFileSync(fileURLToPath(new URL('../../test/fixtures/sample-pt.csv', import.meta.url)));
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

const profile = {
  name: 'Bank',
  delimiter: ';',
  skipRows: 2,
  hasHeader: true,
  dateCol: 0,
  descriptionCols: [1],
  amountMode: 'single',
  amountCol: 3,
  debitCol: null,
  creditCol: null,
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: ',',
  invertSign: false,
};

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;
let aiCalls: AiItem[][];
const groceries = () => (db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").get() as { id: number }).id;
const txCount = () => (db.prepare('SELECT count(*) AS n FROM transactions').get() as { n: number }).n;

beforeEach(() => {
  db = openDb(':memory:');
  aiCalls = [];
  const ai: AiCategorizer = {
    async categorize(items) {
      aiCalls.push(items);
      return new Map(items.map((i) => [i.id, 'Groceries']));
    },
  };
  app = createApp({ db, ai });
  db.prepare("INSERT INTO accounts (name, opening_balance_cents, opening_balance_date) VALUES ('Main', 0, '2026-01-01')").run();
});

const preview = (file: Buffer | string = fixtureBytes) =>
  request(app).post('/api/import/preview').send({ accountId: 1, profile, fileBase64: b64(file) });

const toCommit = (p: ImportPreview, action: CommitRow['action'] = 'save'): CommitRow[] =>
  p.rows.map((r) => ({
    key: r.key, date: r.date, description: r.description, amountCents: r.amountCents,
    categoryId: r.categoryId, categorySource: r.categorySource, action,
  }));

const commit = (rows: CommitRow[]) =>
  request(app).post('/api/import/commit').send({ accountId: 1, fileName: 'f.csv', rows });

const insertManual = (date: string, amountCents: number, description = 'coffee manual') =>
  Number(
    db
      .prepare(
        `INSERT INTO transactions (account_id, date, description, merchant_key, amount_cents, category_id,
          category_source, origin, dedupe_hash) VALUES (1, ?, ?, ?, ?, NULL, 'none', 'manual', ?)`,
      )
      .run(date, description, merchantKey(description), amountCents, descriptionHash(1, date, amountCents, description))
      .lastInsertRowid,
  );

describe('POST /api/import/columns', () => {
  test('returns raw cells', async () => {
    const res = await request(app).post('/api/import/columns').send({ fileBase64: b64(fixtureBytes), delimiter: ';', skipRows: 2 });
    expect(res.status).toBe(200);
    expect(res.body.cells[0]).toEqual(['Data', 'Descricao', 'Detalhe', 'Valor']);
  });
});

describe('POST /api/import/preview', () => {
  test('returns 6 rows and 1 error without writing', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(6);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.rows.every((r: { status: string }) => r.status === 'new')).toBe(true);
    expect(new Set(res.body.rows.map((r: { key: string }) => r.key)).size).toBe(6);
    expect(txCount()).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM import_batches').get()).toEqual({ n: 0 });
  });

  test('never sends transfer-like rows to the AI', async () => {
    const res = await preview();
    const sent = aiCalls.flat().map((i) => i.description);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((d) => /MB WAY/i.test(d))).toBe(false);
    const mb = res.body.rows.find((r: { description: string }) => r.description.includes('MB WAY'));
    expect(mb.categorySource).toBe('none');
  });

  test('commit then re-preview: all duplicates with stored categories, AI not called', async () => {
    const first = (await preview()).body as ImportPreview;
    const gId = groceries();
    expect(first.rows.some((r) => r.categoryId === gId && r.categorySource === 'ai')).toBe(true);
    expect((await commit(toCommit(first))).body.saved).toBe(6);
    const callsBefore = aiCalls.length;

    const second = (await preview()).body as ImportPreview;
    expect(second.rows.every((r) => r.status === 'duplicate')).toBe(true);
    expect(second.rows.map((r) => [r.categoryId, r.categorySource])).toEqual(
      first.rows.map((r) => [r.categoryId, r.categorySource]),
    );
    expect(aiCalls.length).toBe(callsBefore);
  });

  test('same row twice vs. DB with one -> one duplicate, one new', async () => {
    const csv = 'x\ny\nData;D;E;V\n02/11/2026;CAFE;X;-1,80\n02/11/2026;CAFE;X;-1,80\n';
    const date = '2026-11-02';
    db.prepare(
      `INSERT INTO transactions (account_id, date, description, merchant_key, amount_cents, category_source, origin, dedupe_hash)
       VALUES (1, ?, 'CAFE', 'CAFE', -180, 'none', 'import', ?)`,
    ).run(date, descriptionHash(1, date, -180, 'CAFE'));
    const res = await preview(csv);
    expect(res.body.rows.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'new']);
  });

  test('manual entry within 3 days -> possible_manual_match; replace swaps it', async () => {
    const manualId = insertManual('2026-11-03', -1230); // PAGAMENTO SERVICOS is 2026-11-05 / -12,30
    const p = (await preview()).body as ImportPreview;
    const row = p.rows.find((r) => r.amountCents === -1230)!;
    expect(row.status).toBe('possible_manual_match');
    expect(row.matchedManual?.id).toBe(manualId);
    expect(p.rows.filter((r) => r.status === 'possible_manual_match')).toHaveLength(1);

    const rows = toCommit(p, 'skip').map((r) =>
      r.amountCents === -1230 ? { ...r, action: 'replace' as const, replaceTransactionId: manualId } : r,
    );
    const res = await commit(rows);
    expect(res.body).toMatchObject({ saved: 1, skipped: 5 });
    expect(db.prepare('SELECT id FROM transactions WHERE id = ?').get(manualId)).toBeUndefined();
    expect(txCount()).toBe(1);
  });

  test('duplicate is never also a manual match', async () => {
    const first = (await preview()).body as ImportPreview;
    await commit(toCommit(first));
    insertManual('2026-11-05', -1230);
    const second = (await preview()).body as ImportPreview;
    expect(second.rows.every((r) => r.status === 'duplicate')).toBe(true);
  });

  test('validation errors return 400; unknown account 404', async () => {
    expect((await request(app).post('/api/import/preview').send({ accountId: 1 })).status).toBe(400);
    const res = await request(app)
      .post('/api/import/preview')
      .send({ accountId: 99, profile, fileBase64: b64(fixtureBytes) });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/import/commit', () => {
  test('manual category creates a rule; existing transactions keep their category', async () => {
    const old = db
      .prepare(
        `INSERT INTO transactions (account_id, date, description, merchant_key, amount_cents, category_id, category_source, origin, dedupe_hash)
         VALUES (1, '2026-10-01', 'CAFE OLD', 'CAFE', -100, NULL, 'none', 'import', 'h-old')`,
      )
      .run().lastInsertRowid;
    const gId = groceries();
    const res = await commit([
      {
        key: 'L1', date: '2026-11-07', description: 'CAFE PASTELARIA', amountCents: -180,
        categoryId: gId, categorySource: 'manual', action: 'save',
      },
    ]);
    expect(res.status).toBe(200);
    const rule = db.prepare('SELECT category_id AS c FROM rules WHERE merchant_key = ?').get(merchantKey('CAFE PASTELARIA')) as { c: number };
    expect(rule.c).toBe(gId);
    expect(db.prepare('SELECT category_id AS c FROM transactions WHERE id = ?').get(old)).toEqual({ c: null });
    const batch = db.prepare('SELECT * FROM import_batches').get() as { rows_imported: number; file_name: string };
    expect(batch).toMatchObject({ rows_imported: 1, file_name: 'f.csv' });
  });

  test('no rule for an empty merchantKey', async () => {
    const res = await commit([
      { key: 'L1', date: '2026-11-07', description: '12345', amountCents: -5, categoryId: groceries(), categorySource: 'manual', action: 'save' },
    ]);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT count(*) AS n FROM rules').get()).toEqual({ n: 0 });
  });

  test('invalid body or bad replaceTransactionId -> 400 and nothing written', async () => {
    const okRow = { key: 'a', date: '2026-11-07', description: 'X', amountCents: -5, categoryId: null, categorySource: 'none', action: 'save' };
    const imported = db
      .prepare(
        `INSERT INTO transactions (account_id, date, description, merchant_key, amount_cents, category_source, origin, dedupe_hash)
         VALUES (1, '2026-11-07', 'IMP', 'IMP', -5, 'none', 'import', 'h')`,
      )
      .run().lastInsertRowid;
    const bad = [
      { ...okRow, date: '2026-02-31' },
      { ...okRow, amountCents: 1.5 },
      { ...okRow, action: 'bogus' },
      { ...okRow, action: 'replace' },
      { ...okRow, action: 'replace', replaceTransactionId: 999 },
      { ...okRow, action: 'replace', replaceTransactionId: Number(imported) },
      { ...okRow, categoryId: 9999 },
    ];
    for (const row of bad) {
      const res = await commit([okRow as CommitRow, row as CommitRow]);
      expect(res.status).toBe(400);
    }
    expect(txCount()).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM import_batches').get()).toEqual({ n: 0 });
  });

  test('keep_both inserts and leaves the manual entry', async () => {
    const manualId = insertManual('2026-11-03', -1230);
    const res = await commit([
      { key: 'a', date: '2026-11-05', description: 'PAGAMENTO SERVICOS AGUA', amountCents: -1230, categoryId: null, categorySource: 'none', action: 'keep_both' },
    ]);
    expect(res.body.saved).toBe(1);
    expect(txCount()).toBe(2);
    expect(db.prepare('SELECT id FROM transactions WHERE id = ?').get(manualId)).toBeDefined();
  });
});
