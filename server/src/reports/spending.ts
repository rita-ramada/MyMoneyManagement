import type { Category, SpendingSummary, Transaction } from '@mmm/shared/src/types';

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

type Kinds = Map<number, Category['kind']>;

/** Net expense (positive cents) per category id, null = uncategorized; each floored at 0. */
function expenseByCategory(txs: Transaction[], kinds: Kinds): Map<number | null, number> {
  const net = new Map<number | null, number>();
  for (const t of txs) {
    if (t.categoryId === null) {
      if (t.amountCents < 0) net.set(null, (net.get(null) ?? 0) - t.amountCents);
    } else if (kinds.get(t.categoryId) === 'expense') {
      net.set(t.categoryId, (net.get(t.categoryId) ?? 0) - t.amountCents);
    }
  }
  for (const [k, v] of net) net.set(k, Math.max(0, v));
  return net;
}

function sum(values: Iterable<number>): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

function incomeCents(txs: Transaction[], kinds: Kinds): number {
  return sum(
    txs
      .filter((t) => t.amountCents > 0 && (t.categoryId === null || kinds.get(t.categoryId) === 'income'))
      .map((t) => t.amountCents),
  );
}

export function spendingSummary(txs: Transaction[], categories: Category[], month: string): SpendingSummary {
  const kinds: Kinds = new Map(categories.map((c) => [c.id, c.kind]));
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const byMonth = new Map<string, Transaction[]>();
  for (const t of txs) {
    const key = t.date.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(t);
    else byMonth.set(key, [t]);
  }
  const inMonth = byMonth.get(month) ?? [];

  const cur = expenseByCategory(inMonth, kinds);
  const prev = expenseByCategory(byMonth.get(shiftMonth(month, -1)) ?? [], kinds);
  const byCategory: SpendingSummary['byCategory'] = [];
  for (const id of new Set([...cur.keys(), ...prev.keys()])) {
    const cents = cur.get(id) ?? 0;
    const prevCents = prev.get(id) ?? 0;
    if (cents <= 0 && prevCents <= 0) continue;
    byCategory.push({ categoryId: id, name: id === null ? 'Uncategorized' : (names.get(id) ?? ''), cents, prevCents });
  }
  byCategory.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const investingIds = new Set(categories.filter((c) => c.name === 'Investing').map((c) => c.id));
  const investedCents = -sum(
    inMonth.filter((t) => t.categoryId !== null && investingIds.has(t.categoryId)).map((t) => t.amountCents),
  );

  const merchants = new Map<string, { cents: number; count: number }>();
  for (const t of inMonth) {
    const isExpense = t.amountCents < 0 && (t.categoryId === null || kinds.get(t.categoryId) === 'expense');
    if (!isExpense || t.merchantKey === '') continue;
    const m = merchants.get(t.merchantKey) ?? { cents: 0, count: 0 };
    m.cents -= t.amountCents;
    m.count += 1;
    merchants.set(t.merchantKey, m);
  }
  const topMerchants = [...merchants]
    .map(([merchantKey, m]) => ({ merchantKey, ...m }))
    .sort((a, b) => b.cents - a.cents || a.merchantKey.localeCompare(b.merchantKey))
    .slice(0, 10);

  const last12: SpendingSummary['last12'] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const m = shiftMonth(month, -i);
    const rows = byMonth.get(m) ?? [];
    const income = incomeCents(rows, kinds);
    const expense = sum(expenseByCategory(rows, kinds).values());
    last12.push({ month: m, incomeCents: income, expenseCents: expense, netCents: income - expense });
  }

  return {
    month,
    byCategory,
    totalExpenseCents: sum(cur.values()),
    totalIncomeCents: incomeCents(inMonth, kinds),
    investedCents,
    uncategorizedCount: inMonth.filter((t) => t.categoryId === null).length,
    topMerchants,
    last12,
  };
}
