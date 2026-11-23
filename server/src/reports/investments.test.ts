import { describe, expect, test } from 'vitest';
import type { Holding, HoldingContribution, HoldingValuation } from '@mmm/shared/src/types';
import { estimateHoldingSeries } from './investments';

const h: Holding = { id: 1, name: 'ETF', type: 'etf', startDate: '2026-01-01', expectedAnnualReturn: 0.12 };
const monthly = (cents: number, from: string, id = 1): HoldingContribution => ({
  id, holdingId: 1, kind: 'monthly', amountCents: cents, effectiveFrom: from,
});
const oneOff = (cents: number, date: string, id = 9): HoldingContribution => ({
  id, holdingId: 1, kind: 'one_off', amountCents: cents, effectiveFrom: date,
});
const val = (cents: number, date: string, id = 1): HoldingValuation => ({ id, holdingId: 1, date, valueCents: cents });

describe('estimateHoldingSeries', () => {
  test('monthly contribution compounds at the expected return', () => {
    const s = estimateHoldingSeries(h, [monthly(10000, '2026-01-01')], [], '2026-02');
    expect(s).toEqual([
      { month: '2026-01', contributedCents: 10000, valueCents: 10095, confirmed: false },
      { month: '2026-02', contributedCents: 20000, valueCents: 20286, confirmed: false },
    ]);
  });

  test('a valuation overrides the estimate and the series continues from it', () => {
    const s = estimateHoldingSeries(h, [monthly(10000, '2026-01-01')], [val(15000, '2026-01-20')], '2026-02');
    expect(s[0]).toEqual({ month: '2026-01', contributedCents: 10000, valueCents: 15000, confirmed: true });
    expect(s[1]).toEqual({ month: '2026-02', contributedCents: 20000, valueCents: 25237, confirmed: false });
    expect(s[1].valueCents).toBe(Math.round((15000 + 10000) * 1.12 ** (1 / 12)));
  });

  test('the latest valuation in a month wins', () => {
    const s = estimateHoldingSeries(
      h, [], [val(100, '2026-01-05', 1), val(300, '2026-01-25', 2), val(200, '2026-01-10', 3)], '2026-01',
    );
    expect(s[0].valueCents).toBe(300);
  });

  test('a changed monthly amount applies from its month', () => {
    const s = estimateHoldingSeries(h, [monthly(10000, '2026-01-01', 1), monthly(20000, '2026-02-01', 2)], [], '2026-02');
    expect(s.map((p) => p.contributedCents)).toEqual([10000, 30000]);
  });

  test('a monthly change effective mid-month applies for that month', () => {
    const s = estimateHoldingSeries(h, [monthly(10000, '2026-01-01', 1), monthly(20000, '2026-02-15', 2)], [], '2026-02');
    expect(s.map((p) => p.contributedCents)).toEqual([10000, 30000]);
  });

  test('a one-off counts only in its month', () => {
    const s = estimateHoldingSeries(h, [oneOff(100000, '2026-02-10')], [], '2026-03');
    expect(s.map((p) => p.contributedCents)).toEqual([0, 100000, 100000]);
  });

  test('a mid-month start date still contributes in that month', () => {
    const s = estimateHoldingSeries({ ...h, startDate: '2026-01-15' }, [monthly(10000, '2026-01-01')], [], '2026-01');
    expect(s).toHaveLength(1);
    expect(s[0].contributedCents).toBe(10000);
  });

  test('untilMonth before the start month gives an empty series', () => {
    expect(estimateHoldingSeries(h, [monthly(10000, '2026-01-01')], [], '2025-12')).toEqual([]);
  });

  test('contributions and valuations before the start month are ignored', () => {
    const s = estimateHoldingSeries(h, [oneOff(5000, '2025-12-10')], [val(9999, '2025-12-20')], '2026-01');
    expect(s).toEqual([{ month: '2026-01', contributedCents: 0, valueCents: 0, confirmed: false }]);
  });
});
