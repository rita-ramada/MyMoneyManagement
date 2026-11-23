import type { Database } from 'better-sqlite3';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { merchantKey } from '../categorize/text';
import * as repo from '../db/repo';
import { isoDate } from './validation';

const nonEmpty = z.string().trim().min(1);
const col = z.number().int().min(0);

const accountSchema = z.object({
  name: nonEmpty,
  bankProfileId: z.number().int().nullable(),
  openingBalanceCents: z.number().int(),
  openingBalanceDate: isoDate,
});

const profileSchema = z
  .object({
    name: nonEmpty,
    delimiter: z.enum([',', ';', '\t']),
    skipRows: z.number().int().min(0),
    hasHeader: z.boolean(),
    dateCol: col,
    descriptionCols: z.array(col).min(1),
    amountMode: z.enum(['single', 'debitCredit']),
    amountCol: col.nullable(),
    debitCol: col.nullable(),
    creditCol: col.nullable(),
    dateFormat: z.enum(['DD-MM-YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']),
    decimalSeparator: z.enum([',', '.']),
    invertSign: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.amountMode === 'single' && p.amountCol === null) {
      ctx.addIssue({ code: 'custom', path: ['amountCol'], message: "required when amountMode is 'single'" });
    }
    if (p.amountMode === 'debitCredit') {
      if (p.debitCol === null) {
        ctx.addIssue({ code: 'custom', path: ['debitCol'], message: "required when amountMode is 'debitCredit'" });
      }
      if (p.creditCol === null) {
        ctx.addIssue({ code: 'custom', path: ['creditCol'], message: "required when amountMode is 'debitCredit'" });
      }
    }
  });

const categorySchema = z.object({
  name: nonEmpty,
  kind: z.enum(['expense', 'income', 'transfer']),
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

function isConstraintError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

export function setupRouter(db: Database): Router {
  const r = Router();

  const notFound = (res: Response) => fail(res, 'Not found', 404);
  // Resolves the :id param; sends 404 and returns undefined when it is not a valid id.
  const idOr404 = (raw: string, res: Response): number | undefined => {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
    notFound(res);
    return undefined;
  };

  // Accounts
  r.get('/accounts', (_req, res) => {
    res.json(repo.listAccounts(db));
  });
  const profileExists = (id: number | null, res: Response): boolean => {
    if (id !== null && !repo.getBankProfile(db, id)) {
      fail(res, 'bankProfileId does not exist');
      return false;
    }
    return true;
  };
  r.post('/accounts', (req, res) => {
    const body = parseBody(accountSchema, req.body, res);
    if (!body || !profileExists(body.bankProfileId, res)) return;
    res.status(201).json(repo.createAccount(db, body));
  });
  r.put('/accounts/:id', (req, res) => {
    const id = idOr404(req.params.id, res);
    if (id === undefined) return;
    const body = parseBody(accountSchema, req.body, res);
    if (!body || !profileExists(body.bankProfileId, res)) return;
    const updated = repo.updateAccount(db, id, body);
    if (updated) res.json(updated);
    else notFound(res);
  });

  // Bank profiles
  r.get('/bank-profiles', (_req, res) => {
    res.json(repo.listBankProfiles(db));
  });
  r.post('/bank-profiles', (req, res) => {
    const body = parseBody(profileSchema, req.body, res);
    if (body) res.status(201).json(repo.createBankProfile(db, body));
  });
  r.put('/bank-profiles/:id', (req, res) => {
    const id = idOr404(req.params.id, res);
    if (id === undefined) return;
    const body = parseBody(profileSchema, req.body, res);
    if (!body) return;
    const updated = repo.updateBankProfile(db, id, body);
    if (updated) res.json(updated);
    else notFound(res);
  });
  r.delete('/bank-profiles/:id', (req, res) => {
    const id = idOr404(req.params.id, res);
    if (id === undefined) return;
    if (repo.deleteBankProfile(db, id)) res.status(204).end();
    else notFound(res);
  });

  // Categories (no delete in v1)
  r.get('/categories', (_req, res) => {
    res.json(repo.listCategories(db));
  });
  r.post('/categories', (req, res) => {
    const body = parseBody(categorySchema, req.body, res);
    if (!body) return;
    try {
      res.status(201).json(repo.createCategory(db, body));
    } catch (e) {
      if (isConstraintError(e)) fail(res, 'A category with that name already exists');
      else throw e;
    }
  });
  r.put('/categories/:id', (req, res) => {
    const id = idOr404(req.params.id, res);
    if (id === undefined) return;
    const body = parseBody(categorySchema, req.body, res);
    if (!body) return;
    try {
      const updated = repo.updateCategory(db, id, body);
      if (updated) res.json(updated);
      else notFound(res);
    } catch (e) {
      if (isConstraintError(e)) fail(res, 'A category with that name already exists');
      else throw e;
    }
  });

  // Rules
  r.get('/rules', (_req, res) => {
    res.json(repo.listRules(db));
  });
  r.get('/rules/suggest', (req, res) => {
    const description = typeof req.query.description === 'string' ? req.query.description : '';
    res.json({ categoryId: repo.findRuleCategory(db, merchantKey(description)) });
  });
  r.delete('/rules/:id', (req, res) => {
    const id = idOr404(req.params.id, res);
    if (id === undefined) return;
    if (repo.deleteRule(db, id)) res.status(204).end();
    else notFound(res);
  });

  return r;
}
