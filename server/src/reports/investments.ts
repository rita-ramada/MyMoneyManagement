import type { Holding, HoldingContribution, HoldingPoint, HoldingValuation } from '@mmm/shared/src/types';
import { shiftMonth } from './spending';

const monthOf = (date: string): string => date.slice(0, 7);

/**
 * Manual-monthly estimate: each month adds that month's contribution, compounds by the expected
 * annual return (monthly-equivalent), then snaps to the latest valuation of the month if there is one.
 */
export function estimateHoldingSeries(
  h: Holding,
  contributions: HoldingContribution[],
  valuations: HoldingValuation[],
  untilMonth: string,
): HoldingPoint[] {
  const start = monthOf(h.startDate);
  const growth = (1 + h.expectedAnnualReturn) ** (1 / 12);
  const monthly = contributions
    .filter((c) => c.kind === 'monthly')
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id - b.id);
  const oneOffs = contributions.filter((c) => c.kind === 'one_off');

  const points: HoldingPoint[] = [];
  let contributed = 0;
  let value = 0;
  for (let month = start; month <= untilMonth; month = shiftMonth(month, 1)) {
    const current = monthly.filter((c) => monthOf(c.effectiveFrom) <= month).at(-1);
    const added =
      (current?.amountCents ?? 0) +
      oneOffs.filter((c) => monthOf(c.effectiveFrom) === month).reduce((s, c) => s + c.amountCents, 0);
    contributed += added;
    value = (value + added) * growth;

    const inMonth = valuations
      .filter((v) => monthOf(v.date) === month)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const confirmedValue = inMonth.at(-1);
    if (confirmedValue) value = confirmedValue.valueCents;

    points.push({ month, contributedCents: contributed, valueCents: Math.round(value), confirmed: confirmedValue !== undefined });
  }
  return points;
}
