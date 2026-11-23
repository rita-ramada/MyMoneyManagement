import type { Account, HoldingPoint, Transaction } from '@mmm/shared/src/types';
import { shiftMonth } from './spending';

export interface NetWorthPoint { month: string; bankCents: number; investmentsCents: number; totalCents: number }

/** Month-end net worth from the earliest account opening month through `untilMonth`. */
export function netWorthSeries(
  accounts: Account[], txs: Transaction[], holdingSeries: HoldingPoint[][], untilMonth: string,
): NetWorthPoint[] {
  if (accounts.length === 0) return [];
  const start = accounts.map((a) => a.openingBalanceDate.slice(0, 7)).sort()[0];

  // Net change per account per month, counting only transactions on/after that account's opening date.
  const opening = new Map(accounts.map((a) => [a.id, a]));
  const delta = new Map<string, number>(); // `${accountId}|${month}` → cents
  for (const t of txs) {
    const a = opening.get(t.accountId);
    if (!a || t.date < a.openingBalanceDate) continue;
    const k = `${t.accountId}|${t.date.slice(0, 7)}`;
    delta.set(k, (delta.get(k) ?? 0) + t.amountCents);
  }
  const holdingValue = holdingSeries.map((s) => new Map(s.map((p) => [p.month, p.valueCents])));

  const balance = new Map<number, number>();
  const out: NetWorthPoint[] = [];
  for (let month = start; month <= untilMonth; month = shiftMonth(month, 1)) {
    let bankCents = 0;
    for (const a of accounts) {
      if (a.openingBalanceDate.slice(0, 7) > month) continue;
      const b = (balance.get(a.id) ?? a.openingBalanceCents) + (delta.get(`${a.id}|${month}`) ?? 0);
      balance.set(a.id, b);
      bankCents += b;
    }
    const investmentsCents = holdingValue.reduce((sum, m) => sum + (m.get(month) ?? 0), 0);
    out.push({ month, bankCents, investmentsCents, totalCents: bankCents + investmentsCents });
  }
  return out;
}
