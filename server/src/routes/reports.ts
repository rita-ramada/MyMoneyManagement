import type { Database } from 'better-sqlite3';
import { Router } from 'express';
import { z } from 'zod';
import * as repo from '../db/repo';
import { netWorthSeries } from '../reports/netWorth';
import { shiftMonth, spendingSummary } from '../reports/spending';
import { investmentsReport } from './holdings';
import { isoMonth } from './validation';

const spendingQuery = z.object({
  month: isoMonth.optional(),
  accountId: z.string().regex(/^\d+$/).transform(Number).optional(),
});

const untilQuery = z.object({ until: isoMonth.optional() });

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function reportsRouter(db: Database): Router {
  const r = Router();

  r.get('/reports/spending', (req, res) => {
    const q = spendingQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ') });
      return;
    }
    const { accountId } = q.data;
    const month = q.data.month ?? repo.latestTransactionMonth(db, accountId) ?? currentMonth();
    const txs = repo.listTransactions(db, {
      accountId,
      from: `${shiftMonth(month, -11)}-01`,
      to: `${month}-31`,
    });
    res.json(spendingSummary(txs, repo.listCategories(db), month));
  });

  r.get('/reports/net-worth', (req, res) => {
    const q = untilQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ') });
      return;
    }
    const until = q.data.until ?? currentMonth();
    // Text comparison on fixed-width ISO dates: '-31' is an inclusive upper bound for any month.
    const txs = repo.listTransactions(db, { to: `${until}-31` });
    const holdingSeries = investmentsReport(db, until).map((h) => h.series);
    res.json(netWorthSeries(repo.listAccounts(db), txs, holdingSeries, until));
  });

  return r;
}
