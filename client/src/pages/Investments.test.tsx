import type { Holding } from '@mmm/shared/src/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api, type HoldingReportRow } from '../api';
import Investments from './Investments';

vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, api: Object.fromEntries(Object.keys(real.api).map((k) => [k, vi.fn()])) };
});
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const etf: Holding = { id: 1, name: 'Trading 212 ETFs', type: 'etf', startDate: '2026-01-01', expectedAnnualReturn: 0.07 };
const row: HoldingReportRow = {
  holding: etf,
  series: [
    { month: '2026-10', contributedCents: 100000, valueCents: 103000, confirmed: true },
    { month: '2026-11', contributedCents: 110000, valueCents: 113600, confirmed: false },
  ],
  latest: { month: '2026-11', contributedCents: 110000, valueCents: 113600, confirmed: false },
  gainCents: 3600,
  gainPct: 0.0327,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Investments /></QueryClientProvider>);
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.investmentsReport.mockResolvedValue({ holdings: [row] });
  m.listContributions.mockResolvedValue([]);
  m.listValuations.mockResolvedValue([]);
  m.addValuation.mockResolvedValue({ id: 1, holdingId: 1, date: '2026-11-20', valueCents: 150050 });
  m.createHolding.mockImplementation(async (h) => ({ id: 2, ...h }));
});

describe('Investments', () => {
  test('a holding whose latest value is not confirmed is labelled estimated', async () => {
    renderPage();
    const card = await screen.findByRole('article');
    expect(within(card).getByText(/estimated/i)).toBeInTheDocument();
    expect(within(card).getByText(/3,27\s?%/)).toBeInTheDocument();
  });

  test('updating the value posts a valuation in cents', async () => {
    renderPage();
    const user = userEvent.setup();
    const card = await screen.findByRole('article');
    await user.click(within(card).getByRole('button', { name: 'Update value' }));
    const dialog = screen.getByRole('dialog', { name: /Update value/ });
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-11-20');
    await user.type(within(dialog).getByLabelText('Current value (€)'), '1500,50');
    await user.click(within(dialog).getByRole('button', { name: 'Save value' }));
    await waitFor(() => expect(m.addValuation).toHaveBeenCalledWith(1, { date: '2026-11-20', valueCents: 150050 }));
  });

  test('an expected return of 2,5 % is saved as 0.025', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add holding' }));
    const dialog = screen.getByRole('dialog', { name: /Add holding/ });
    await user.type(within(dialog).getByLabelText('Name'), 'Certificados de Aforro A');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'savings_certificate');
    await user.clear(within(dialog).getByLabelText('Start date'));
    await user.type(within(dialog).getByLabelText('Start date'), '2025-03-01');
    await user.type(within(dialog).getByLabelText('Expected yearly return (%)'), '2,5');
    await user.click(within(dialog).getByRole('button', { name: 'Save holding' }));
    await waitFor(() => expect(m.createHolding).toHaveBeenCalledWith({
      name: 'Certificados de Aforro A', type: 'savings_certificate', startDate: '2025-03-01', expectedAnnualReturn: 0.025,
    }));
  });
});
