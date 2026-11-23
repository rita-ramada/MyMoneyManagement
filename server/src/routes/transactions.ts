import type { Database } from 'better-sqlite3';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { merchantKey } from '../categorize/text';
import * as repo from '../db/repo';
import { toExcelCsv } from '../export/excelCsv';
import { descriptionHash } from '../import/dedupe';
import { isoDate, isoMonth } from './validation';

const intStr = z.string().regex(/^\d+$/).transform(Number);

const filterSchema = z.object({
  accountId: intStr.optional(),
  categoryId: z.union([z.literal('none'), intStr]).optional(),
  month: isoMonth.optional(),
  q: z.string().optional(),
  uncategorized: z.literal('1').optional(),
});

const createSchema = z.object({
  accountId: z.number().int(),
  date: isoDate,
  description: z.string(),
  amountCents: z.number().int(),
  categoryId: z.number().int().nullable(),
});

const patchSchema = z.object({
  date: isoDate.optional(),
  description: z.string().optional(),
  amountCents: z.number().int().optional(),
  categoryId: z.number().int().nullable().optional(),
});

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: message });
}

function parse<T>(schema: z.ZodType<T>, data: unknown, res: Response): T | undefined {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  fail(res, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return undefined;
}

function parseFilter(query: unknown, res: Response): repo.TransactionFilter | undefined {
  const f = parse(filterSchema, query, res);
  if (!f) return undefined;
  return {
    accountId: f.accountId,
    categoryId: f.categoryId ?? (f.uncategorized ? 'none' : undefined),
    month: f.month,
    q: f.q,
  };
}

function parseId(raw: string): number | undefined {
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

export function transactionsRouter(db: Database): Router {
  const r = Router();

  r.get('/transactions', (req, res) => {
    const f = parseFilter(req.query, res);
    if (f) res.json(repo.listTransactions(db, f));
  });

  r.post('/transactions', (req, res) => {
    const b = parse(createSchema, req.body, res);
    if (!b) return;
    if (!repo.getAccount(db, b.accountId)) return fail(res, 'Account not found', 404);
    if (b.categoryId !== null && !repo.categoryExists(db, b.categoryId)) {
      return fail(res, `Unknown category ${b.categoryId}`);
    }
    const mk = merchantKey(b.description);
    const suggested = repo.findRuleCategory(db, mk);
    const source = b.categoryId === null ? 'none' : b.categoryId === suggested ? 'rule' : 'manual';
    const id = db.transaction(() => {
      const newId = repo.insertTransaction(db, {
        accountId: b.accountId,
        date: b.date,
        description: b.description,
        merchantKey: mk,
        amountCents: b.amountCents,
        categoryId: b.categoryId,
        categorySource: source,
        origin: 'manual',
        importBatchId: null,
        dedupeHash: descriptionHash(b.accountId, b.date, b.amountCents, b.description),
      });
      if (source === 'manual' && mk !== '') repo.upsertRule(db, mk, b.categoryId!);
      return newId;
    })();
    res.status(201).json(repo.getTransaction(db, id));
  });

  r.patch('/transactions/:id', (req, res) => {
    const id = parseId(req.params.id);
    const t = id === undefined ? undefined : repo.getTransaction(db, id);
    if (id === undefined || !t) return fail(res, 'Transaction not found', 404);
    const b = parse(patchSchema, req.body, res);
    if (!b) return;
    if (b.categoryId != null && !repo.categoryExists(db, b.categoryId)) {
      return fail(res, `Unknown category ${b.categoryId}`);
    }
    const patch: repo.TransactionPatch = {};
    if (b.date !== undefined) patch.date = b.date;
    if (b.amountCents !== undefined) patch.amountCents = b.amountCents;
    if (b.description !== undefined) {
      patch.description = b.description;
      patch.merchantKey = merchantKey(b.description);
    }
    if (b.categoryId !== undefined) {
      patch.categoryId = b.categoryId;
      patch.categorySource = b.categoryId === null ? 'none' : 'manual';
    }
    if (b.date !== undefined || b.amountCents !== undefined || b.description !== undefined) {
      patch.dedupeHash = descriptionHash(
        t.accountId, b.date ?? t.date, b.amountCents ?? t.amountCents, b.description ?? t.description,
      );
    }
    const updated = db.transaction(() => {
      const u = repo.updateTransaction(db, id, patch);
      // The rule is keyed by this row's (possibly new) merchant key; other transactions are untouched.
      if (b.categoryId != null && u && u.merchantKey !== '') repo.upsertRule(db, u.merchantKey, b.categoryId);
      return u;
    })();
    res.json(updated);
  });

  r.delete('/transactions/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.deleteTransaction(db, id)) return fail(res, 'Transaction not found', 404);
    res.status(204).end();
  });

  return r;
}

// ---- export ----

function sendCsv(res: Response, filename: string, csv: string): void {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.send(csv);
}

export function exportRouter(db: Database): Router {
  const r = Router();

  r.get('/export/transactions.csv', (req, res) => {
    const f = parseFilter(req.query, res);
    if (!f) return;
    const accounts = new Map(repo.listAccounts(db).map((a) => [a.id, a.name]));
    const categories = new Map(repo.listCategories(db).map((c) => [c.id, c.name]));
    const rows = repo.listTransactions(db, f).map((t) => [
      t.date,
      accounts.get(t.accountId) ?? '',
      t.description,
      t.amountCents / 100,
      t.categoryId === null ? '' : (categories.get(t.categoryId) ?? ''),
    ]);
    sendCsv(res, 'transactions.csv', toExcelCsv(['Date', 'Account', 'Description', 'Amount', 'Category'], rows));
  });

  // Task 11 adds GET /export/holdings.csv here (reuse sendCsv).

  return r;
}
