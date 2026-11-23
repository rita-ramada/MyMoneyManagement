import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api';
import Settings from './Settings';

vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  const fns = Object.fromEntries(Object.keys(real.api).map((k) => [k, vi.fn()]));
  return { ...real, api: fns };
});
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Settings /></QueryClientProvider>);
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.listAccounts.mockResolvedValue([]);
  m.listBankProfiles.mockResolvedValue([]);
  m.listCategories.mockResolvedValue([{ id: 1, name: 'Groceries', kind: 'expense' }]);
  m.listRules.mockResolvedValue([]);
  m.getSettings.mockResolvedValue({ transferPatterns: ['TRF'], aiEnabled: true, aiConfigured: false });
});

describe('Settings', () => {
  test('shows that no API key is configured', async () => {
    renderPage();
    expect(await screen.findByText(/No API key/)).toBeInTheDocument();
  });

  test('adding an account sends the opening balance in cents', async () => {
    m.createAccount.mockResolvedValue({ id: 1, name: 'Main', bankProfileId: null, openingBalanceCents: 123450, openingBalanceDate: '2026-01-01' });
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Account name'), 'Main');
    await user.type(screen.getByLabelText('Opening balance (€)'), '1234,50');
    await user.clear(screen.getByLabelText('Opening balance date'));
    await user.type(screen.getByLabelText('Opening balance date'), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(m.createAccount).toHaveBeenCalledWith({
      name: 'Main', bankProfileId: null, openingBalanceCents: 123450, openingBalanceDate: '2026-01-01',
    }));
  });
});
