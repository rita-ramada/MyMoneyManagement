import { describe, expect, test } from 'vitest';
import type { Category, Transaction } from '@mmm/shared/src/types';
import { spendingSummary } from './spending';

const cats: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Shopping', kind: 'expense' },
  { id: 3, name: 'Salary', kind: 'income' },
  { id: 4, name: 'Transfers', kind: 'transfer' },
  { id: 5, name: 'Investing', kind: 'transfer' },
];

let n = 0;
function tx(date: string, amountCents: number, categoryId: number | null, mk = 'm'): Transaction {
  n += 1;
  return {
    id: n, accountId: 1, date, description: mk, merchantKey: mk, amountCents, categoryId,
    categorySource: 'none', origin: 'import', importBatchId: null, dedupeHash: `h${n}`,
  };
}

describe('spendingSummary', () => {
  test('byCategory has current and previous month cents', () => {
    const s = spendingSummary([tx('2026-11-03', -5000, 1), tx('2026-10-03', -3000, 1)], cats, '2026-11');
    expect(s.byCategory).toEqual([{ categoryId: 1, name: 'Groceries', cents: 5000, prevCents: 3000 }]);
    expect(s.totalExpenseCents).toBe(5000);
  });

  test('previous-month-only category still appears with cents 0', () => {
    const s = spendingSummary([tx('2026-10-03', -3000, 1)], cats, '2026-11');
    expect(s.byCategory).toEqual([{ categoryId: 1, name: 'Groceries', cents: 0, prevCents: 3000 }]);
  });

  test('transfer rows are excluded; Investing sets investedCents', () => {
    const s = spendingSummary(
      [tx('2026-11-03', -20000, 4), tx('2026-11-04', -10000, 5), tx('2026-11-05', -100, 1)],
      cats, '2026-11',
    );
    expect(s.totalExpenseCents).toBe(100);
    expect(s.totalIncomeCents).toBe(0);
    expect(s.investedCents).toBe(10000);
    expect(s.byCategory.map((c) => c.categoryId)).toEqual([1]);
  });

  test('refund reduces category expense, floored at 0', () => {
    const s = spendingSummary([tx('2026-11-03', -2000, 2), tx('2026-11-05', 500, 2)], cats, '2026-11');
    expect(s.byCategory[0]).toMatchObject({ categoryId: 2, cents: 1500 });
    expect(s.totalExpenseCents).toBe(1500);
    const f = spendingSummary([tx('2026-11-03', -200, 2), tx('2026-11-05', 500, 2)], cats, '2026-11');
    expect(f.byCategory).toEqual([]);
    expect(f.totalExpenseCents).toBe(0);
  });

  test('income and uncategorized handling', () => {
    const s = spendingSummary(
      [
        tx('2026-11-01', 100000, 3), tx('2026-11-02', 700, null), tx('2026-11-03', -900, null, 'x'),
        tx('2026-11-04', -100, 2), tx('2026-11-05', 300, 1),
      ],
      cats, '2026-11',
    );
    expect(s.totalIncomeCents).toBe(100700);
    expect(s.uncategorizedCount).toBe(2);
    expect(s.byCategory).toEqual([
      { categoryId: null, name: 'Uncategorized', cents: 900, prevCents: 0 },
      { categoryId: 2, name: 'Shopping', cents: 100, prevCents: 0 },
    ]);
    expect(s.totalExpenseCents).toBe(1000);
  });

  test('last12 has 12 entries ending at month, zero-filled, crossing the year boundary', () => {
    const s = spendingSummary([tx('2026-02-03', -400, 1), tx('2026-02-04', 1000, 3), tx('2025-03-01', -50, 1)], cats, '2026-02');
    expect(s.last12).toHaveLength(12);
    expect(s.last12[0]).toEqual({ month: '2025-03', incomeCents: 0, expenseCents: 50, netCents: -50 });
    expect(s.last12[1]).toEqual({ month: '2025-04', incomeCents: 0, expenseCents: 0, netCents: 0 });
    expect(s.last12[9].month).toBe('2025-12');
    expect(s.last12[10].month).toBe('2026-01');
    expect(s.last12[11]).toEqual({ month: '2026-02', incomeCents: 1000, expenseCents: 400, netCents: 600 });
  });

  test('topMerchants groups by merchantKey, max 10, excludes income', () => {
    const rows: Transaction[] = [];
    for (let i = 0; i < 12; i += 1) rows.push(tx('2026-11-03', -(100 + i), 1, `shop${String(i).padStart(2, '0')}`));
    rows.push(tx('2026-11-04', -50, 1, 'shop11'), tx('2026-11-05', 99999, 3, 'employer'), tx('2026-11-06', -10, 1, ''));
    const s = spendingSummary(rows, cats, '2026-11');
    expect(s.topMerchants).toHaveLength(10);
    expect(s.topMerchants[0]).toEqual({ merchantKey: 'shop11', cents: 161, count: 2 });
    expect(s.topMerchants.some((m) => m.merchantKey === 'employer' || m.merchantKey === '')).toBe(false);
  });
});
