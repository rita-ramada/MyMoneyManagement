import type { SpendingSummary } from '@mmm/shared/src/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api';
import { formatEuros } from '../format';
import Spending from './Spending';

vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, api: Object.fromEntries(Object.keys(real.api).map((k) => [k, vi.fn()])) };
});
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const norm = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

const report = (p: Partial<SpendingSummary> = {}): SpendingSummary => ({
  month: '2026-11',
  byCategory: [
    { categoryId: 1, name: 'Groceries', cents: 32000, prevCents: 25000 },
    { categoryId: 2, name: 'Travel', cents: 15000, prevCents: 0 },
  ],
  totalExpenseCents: 47000, totalIncomeCents: 210000, investedCents: 20000, uncategorizedCount: 3,
  topMerchants: [{ merchantKey: 'CONTINENTE LISBOA', cents: 18000, count: 4 }],
  last12: [{ month: '2026-11', incomeCents: 210000, expenseCents: 47000, netCents: 163000 }],
  ...p,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Spending /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.listAccounts.mockResolvedValue([]);
});

describe('Spending dashboard', () => {
  test('tiles show the formatted totals', async () => {
    m.spendingReport.mockResolvedValue(report());
    renderPage();
    expect(norm((await screen.findByTestId('tile-expenses')).textContent)).toContain(norm(formatEuros(47000)));
    expect(norm((screen.getByTestId('tile-income')).textContent)).toContain(norm(formatEuros(210000)));
    expect(norm((screen.getByTestId('tile-net')).textContent)).toContain(norm(formatEuros(163000)));
    expect(norm((screen.getByTestId('tile-invested')).textContent)).toContain(norm(formatEuros(20000)));
  });

  test('a category with no spend last month shows "new" instead of a percentage', async () => {
    m.spendingReport.mockResolvedValue(report());
    renderPage();
    expect(await screen.findByTestId('delta-Travel')).toHaveTextContent('new');
    expect(screen.getByTestId('delta-Groceries')).toHaveTextContent('▲ 28%');
  });

  test('links to uncategorized transactions for the month, hidden when there are none', async () => {
    m.spendingReport.mockResolvedValue(report());
    const { unmount } = renderPage();
    const link = await screen.findByRole('link', { name: /3 uncategorized/ });
    expect(link).toHaveAttribute('href', '/transactions?categoryId=none&month=2026-11');
    unmount();

    m.spendingReport.mockResolvedValue(report({ uncategorizedCount: 0 }));
    renderPage();
    await screen.findByTestId('tile-expenses');
    expect(screen.queryByRole('link', { name: /uncategorized/ })).not.toBeInTheDocument();
  });
});
