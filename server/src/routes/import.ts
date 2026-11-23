import type { Database } from 'better-sqlite3';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { ImportPreview, PreviewRow, Transaction } from '@mmm/shared/src/types';
import type { AiCategorizer } from '../categorize/ai';
import { categorizeRows } from '../categorize/categorizer';
import { merchantKey } from '../categorize/text';
import * as repo from '../db/repo';
import { decodeCsvBytes, parseCsv, previewColumns } from '../import/csv';
import { descriptionHash, markDuplicates, matchManualEntries } from '../import/dedupe';
import { profileSchema } from './setup';
import { isoDate } from './validation';

const MS_PER_DAY = 86_400_000;
const MATCH_DAYS = 3;

const columnsSchema = z.object({
  fileBase64: z.string(),
  delimiter: z.enum([',', ';', '\t']),
  skipRows: z.number().int().min(0),
});

const previewSchema = z.object({
  accountId: z.number().int(),
  // An `id` on the profile (saved, or edited but unsaved) is ignored; the given fields are used as sent.
  profile: profileSchema,
  fileBase64: z.string(),
});

const commitRowSchema = z
  .object({
    key: z.string(),
    date: isoDate,
    description: z.string(),
    amountCents: z.number().int(),
    categoryId: z.number().int().nullable(),
    categorySource: z.enum(['rule', 'ai', 'manual', 'none']),
    action: z.enum(['save', 'skip', 'replace', 'keep_both']),
    replaceTransactionId: z.number().int().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.action === 'replace' && r.replaceTransactionId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['replaceTransactionId'], message: "required when action is 'replace'" });
    }
  });

const commitSchema = z.object({
  accountId: z.number().int(),
  fileName: z.string(),
  rows: z.array(commitRowSchema),
});

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: message });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  fail(res, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return undefined;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function importRouter(db: Database, ai: AiCategorizer | null): Router {
  const r = Router();

  r.post('/import/columns', (req, res) => {
    const b = parseBody(columnsSchema, req.body, res);
    if (!b) return;
    const text = decodeCsvBytes(Buffer.from(b.fileBase64, 'base64'));
    res.json({ cells: previewColumns(text, b.delimiter, b.skipRows) });
  });

  r.post('/import/preview', async (req, res) => {
    const b = parseBody(previewSchema, req.body, res);
    if (!b) return;
    if (!repo.getAccount(db, b.accountId)) return fail(res, 'Account not found', 404);

    const text = decodeCsvBytes(Buffer.from(b.fileBase64, 'base64'));
    const { rows: parsed, errors } = parseCsv(text, b.profile);
    const hashes = parsed.map((p) => descriptionHash(b.accountId, p.date, p.amountCents, p.description));
    const stored = repo.transactionsByHash(db, b.accountId, hashes);
    const isDup = markDuplicates(hashes, new Map([...stored].map(([h, list]) => [h, list.length])));

    // Manual-match candidates are considered for non-duplicate rows only.
    const fresh = parsed.map((p, i) => ({ p, i })).filter(({ i }) => !isDup[i]);
    let matched: (number | null)[] = fresh.map(() => null);
    const manualById = new Map<number, Transaction>();
    if (fresh.length > 0) {
      const dates = fresh.map(({ p }) => p.date).sort();
      const manual = repo.listManualTransactions(
        db, b.accountId, shiftDate(dates[0], -MATCH_DAYS), shiftDate(dates[dates.length - 1], MATCH_DAYS),
      );
      manual.forEach((m) => manualById.set(m.id, m));
      matched = matchManualEntries(fresh.map(({ p }) => p), manual);
    }
    const matchByIndex = new Map(fresh.map(({ i }, k) => [i, matched[k]]));

    const { results, aiNotice } = await categorizeRows(
      fresh.map(({ p }) => ({ key: `L${p.line}`, description: p.description, amountCents: p.amountCents })),
      {
        rules: new Map(repo.listRules(db).map((x) => [x.merchantKey, x.categoryId])),
        transferPatterns: repo.getSetting<string[]>(db, 'transferPatterns', []),
        categories: repo.listCategories(db),
        ai,
        aiEnabled: repo.getSetting<boolean>(db, 'aiEnabled', true),
      },
    );

    const seen = new Map<string, number>();
    const out: PreviewRow[] = parsed.map((p, i) => {
      const key = `L${p.line}`;
      const base = { key, line: p.line, date: p.date, description: p.description, amountCents: p.amountCents };
      if (isDup[i]) {
        const n = seen.get(hashes[i]) ?? 0;
        seen.set(hashes[i], n + 1);
        const t = stored.get(hashes[i])![n];
        return {
          ...base, status: 'duplicate', categoryId: t.categoryId, categorySource: t.categorySource, matchedManual: null,
        };
      }
      const c = results.get(key) ?? { categoryId: null, source: 'none' as const };
      const manualId = matchByIndex.get(i) ?? null;
      return {
        ...base,
        status: manualId === null ? 'new' : 'possible_manual_match',
        categoryId: c.categoryId,
        categorySource: c.source,
        matchedManual: manualId === null ? null : (manualById.get(manualId) ?? null),
      };
    });
    const body: ImportPreview = { rows: out, errors, aiNotice };
    res.json(body);
  });

  r.post('/import/commit', (req, res) => {
    const b = parseBody(commitSchema, req.body, res);
    if (!b) return;
    if (!repo.getAccount(db, b.accountId)) return fail(res, 'Account not found', 404);

    const replaceIds = new Set<number>();
    for (const row of b.rows) {
      if (row.categoryId !== null && !repo.categoryExists(db, row.categoryId)) {
        return fail(res, `Unknown category ${row.categoryId}`);
      }
      if (row.action !== 'replace') continue;
      const id = row.replaceTransactionId!;
      const t = repo.getTransaction(db, id);
      if (!t || t.accountId !== b.accountId || t.origin !== 'manual') {
        return fail(res, `replaceTransactionId ${id} must be a manual transaction on this account`);
      }
      if (replaceIds.has(id)) return fail(res, `replaceTransactionId ${id} is used more than once`);
      replaceIds.add(id);
    }

    const skippedCount = b.rows.filter((x) => x.action === 'skip').length;
    const result = db.transaction(() => {
      const batchId = repo.createImportBatch(db, {
        accountId: b.accountId,
        fileName: b.fileName,
        rowsTotal: b.rows.length,
        rowsImported: b.rows.length - skippedCount,
        rowsDuplicate: skippedCount,
      });
      for (const row of b.rows) {
        if (row.action === 'skip') continue;
        if (row.action === 'replace') repo.deleteTransaction(db, row.replaceTransactionId!);
        const mk = merchantKey(row.description);
        repo.insertTransaction(db, {
          accountId: b.accountId,
          date: row.date,
          description: row.description,
          merchantKey: mk,
          amountCents: row.amountCents,
          categoryId: row.categoryId,
          categorySource: row.categoryId === null ? 'none' : row.categorySource,
          origin: 'import',
          importBatchId: batchId,
          dedupeHash: descriptionHash(b.accountId, row.date, row.amountCents, row.description),
        });
        if (row.categorySource === 'manual' && row.categoryId !== null && mk !== '') {
          repo.upsertRule(db, mk, row.categoryId);
        }
      }
      return { batchId, saved: b.rows.length - skippedCount, skipped: skippedCount };
    })();
    res.json(result);
  });

  return r;
}
