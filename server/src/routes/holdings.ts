import type { Database } from 'better-sqlite3';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Holding, HoldingPoint } from '@mmm/shared/src/types';
import * as repo from '../db/repo';
import { estimateHoldingSeries } from '../reports/investments';
import { currentMonth } from './reports';
import { isoDate, isoMonth } from './validation';

const holdingSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['savings_certificate', 'etf', 'stock', 'crypto', 'savings']),
  startDate: isoDate,
  expectedAnnualReturn: z.number().min(-1).max(1),
});

const contributionSchema = z.object({
  kind: z.enum(['monthly', 'one_off']),
  amountCents: z.number().int().min(0),
  effectiveFrom: isoDate,
});

const valuationSchema = z.object({
  date: isoDate,
  valueCents: z.number().int().min(0),
});

const untilQuery = z.object({ until: isoMonth.optional() });

export interface HoldingReportRow {
  holding: Holding;
  series: HoldingPoint[];
  latest: HoldingPoint | null;
  gainCents: number;
  gainPct: number;
}

export function investmentsReport(db: Database, until: string): HoldingReportRow[] {
  return repo.listHoldings(db).map((holding) => {
    const series = estimateHoldingSeries(
      holding, repo.listContributions(db, holding.id), repo.listValuations(db, holding.id), until,
    );
    const latest = series.at(-1) ?? null;
    const gainCents = latest ? latest.valueCents - latest.contributedCents : 0;
    const gainPct = latest && latest.contributedCents > 0 ? Math.round((gainCents / latest.contributedCents) * 10000) / 10000 : 0;
    return { holding, series, latest, gainCents, gainPct };
  });
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: message });
}

function parse<T>(schema: z.ZodType<T>, data: unknown, res: Response): T | undefined {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  fail(res, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return undefined;
}

function parseId(raw: string): number | undefined {
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

export function holdingsRouter(db: Database): Router {
  const r = Router();

  r.get('/holdings', (_req, res) => {
    res.json(repo.listHoldings(db));
  });

  r.post('/holdings', (req, res) => {
    const b = parse(holdingSchema, req.body, res);
    if (b) res.status(201).json(repo.insertHolding(db, b));
  });

  r.put('/holdings/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.getHolding(db, id)) return fail(res, 'Holding not found', 404);
    const b = parse(holdingSchema, req.body, res);
    if (b) res.json(repo.updateHolding(db, id, b));
  });

  r.delete('/holdings/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.deleteHolding(db, id)) return fail(res, 'Holding not found', 404);
    res.status(204).end();
  });

  r.get('/holdings/:id/contributions', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.getHolding(db, id)) return fail(res, 'Holding not found', 404);
    res.json(repo.listContributions(db, id));
  });

  r.get('/holdings/:id/valuations', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.getHolding(db, id)) return fail(res, 'Holding not found', 404);
    res.json(repo.listValuations(db, id));
  });

  r.post('/holdings/:id/contributions', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.getHolding(db, id)) return fail(res, 'Holding not found', 404);
    const b = parse(contributionSchema, req.body, res);
    if (b) res.status(201).json(repo.insertContribution(db, { holdingId: id, ...b }));
  });

  r.delete('/holding-contributions/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.deleteContribution(db, id)) return fail(res, 'Contribution not found', 404);
    res.status(204).end();
  });

  r.post('/holdings/:id/valuations', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.getHolding(db, id)) return fail(res, 'Holding not found', 404);
    const b = parse(valuationSchema, req.body, res);
    if (b) res.status(201).json(repo.insertValuation(db, { holdingId: id, ...b }));
  });

  r.delete('/holding-valuations/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === undefined || !repo.deleteValuation(db, id)) return fail(res, 'Valuation not found', 404);
    res.status(204).end();
  });

  r.get('/reports/investments', (req, res) => {
    const q = parse(untilQuery, req.query, res);
    if (q) res.json({ holdings: investmentsReport(db, q.until ?? currentMonth()) });
  });

  return r;
}
