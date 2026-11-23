import { describe, expect, test } from 'vitest';
import type { Account, HoldingPoint, Transaction } from '@mmm/shared/src/types';
import { netWorthSeries } from './netWorth';

function acct(id: number, openingBalanceCents: number, openingBalanceDate: string): Account {
  return { id, name: `A${id}`, bankProfileId: null, openingBalanceCents, openingBalanceDate };
}
let n = 0;
function tx(accountId: number, date: string, amountCents: number): Transaction {
  n += 1;
  return {
    id: n, accountId, date, description: 'x', merchantKey: 'X', amountCents, categoryId: null,
    categorySource: 'none', origin: 'manual', importBatchId: null, dedupeHash: `h${n}`,
  };
}
const pt = (month: string, valueCents: number): HoldingPoint => ({ month, contributedCents: 0, valueCents, confirmed: false });

describe('netWorthSeries', () => {
  test('carries the balance forward through months with no transactions', () => {
    const s = netWorthSeries([acct(1, 100000, '2026-01-01')], [tx(1, '2026-01-15', -10000)], [], '2026-02');
    expect(s).toEqual([
      { month: '2026-01', bankCents: 90000, investmentsCents: 0, totalCents: 90000 },
      { month: '2026-02', bankCents: 90000, investmentsCents: 0, totalCents: 90000 },
    ]);
  });

  test('ignores transactions dated before the opening balance date', () => {
    const s = netWorthSeries([acct(1, 100000, '2026-01-10')], [tx(1, '2026-01-05', -5000), tx(1, '2026-01-10', -1000)], [], '2026-01');
    expect(s[0].bankCents).toBe(99000);
  });

  test('an account opening later contributes 0 before its opening month', () => {
    const s = netWorthSeries([acct(1, 1000, '2026-01-01'), acct(2, 50000, '2026-03-01')], [], [], '2026-03');
    expect(s.map((p) => p.bankCents)).toEqual([1000, 1000, 51000]);
  });

  test('counts a transaction only from its own month onwards (month-end balances)', () => {
    const s = netWorthSeries([acct(1, 0, '2026-01-01')], [tx(1, '2026-02-28', 500)], [], '2026-03');
    expect(s.map((p) => p.bankCents)).toEqual([0, 500, 500]);
  });

  test('adds holding values per month, 0 before a holding starts', () => {
    const s = netWorthSeries(
      [acct(1, 1000, '2026-01-01')], [],
      [[pt('2026-02', 20000), pt('2026-03', 20200)], [pt('2026-01', 5000), pt('2026-02', 5100), pt('2026-03', 5200)]],
      '2026-03',
    );
    expect(s.map((p) => p.investmentsCents)).toEqual([5000, 25100, 25400]);
    expect(s.map((p) => p.totalCents)).toEqual([6000, 26100, 26400]);
  });

  test('crosses a year boundary', () => {
    const s = netWorthSeries([acct(1, 0, '2025-12-01')], [], [], '2026-01');
    expect(s.map((p) => p.month)).toEqual(['2025-12', '2026-01']);
  });

  test('no accounts → empty series', () => {
    expect(netWorthSeries([], [], [[pt('2026-01', 100)]], '2026-01')).toEqual([]);
  });

  test('until before the earliest opening month → empty series', () => {
    expect(netWorthSeries([acct(1, 0, '2026-05-01')], [], [], '2026-04')).toEqual([]);
  });
});
