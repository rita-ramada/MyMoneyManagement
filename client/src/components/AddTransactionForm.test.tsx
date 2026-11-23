import type { Account, Category } from '@mmm/shared/src/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api';
import AddTransactionForm from './AddTransactionForm';

vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, api: Object.fromEntries(Object.keys(real.api).map((k) => [k, vi.fn()])) };
});
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const accounts: Account[] = [{ id: 1, name: 'Main', bankProfileId: null, openingBalanceCents: 0, openingBalanceDate: '2026-01-01' }];
const categories: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Eating Out', kind: 'expense' },
  { id: 3, name: 'Shopping', kind: 'expense' },
  { id: 4, name: 'Salary', kind: 'income' },
];

function renderForm(onSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AddTransactionForm accounts={accounts} categories={categories} onSaved={onSaved} /></QueryClientProvider>);
  return onSaved;
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.suggestCategory.mockResolvedValue({ categoryId: null });
  m.createTransaction.mockImplementation(async (t) => ({ id: 1, ...t }));
});

describe('AddTransactionForm', () => {
  test('pre-selects the suggested category for the description', async () => {
    m.suggestCategory.mockResolvedValue({ categoryId: 3 });
    renderForm();
    await userEvent.type(screen.getByLabelText('Description'), 'Continente');
    await waitFor(() => expect(screen.getByLabelText('Category')).toHaveValue('3'));
    expect(m.suggestCategory).toHaveBeenLastCalledWith('Continente');
  });

  test('keeps a category the user picked before the suggestion arrives', async () => {
    let resolve!: (v: { categoryId: number }) => void;
    m.suggestCategory.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Description'), 'Continente');
    await waitFor(() => expect(m.suggestCategory).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText('Category'), '2');
    resolve({ categoryId: 3 });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByLabelText('Category')).toHaveValue('2');
  });

  test('an expense of 12,30 is sent as -1230 cents', async () => {
    const onSaved = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Description'), 'Coffee');
    await user.type(screen.getByLabelText('Amount (€)'), '12,30');
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(m.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ accountId: 1, description: 'Coffee', amountCents: -1230 })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  test('income of 12,30 is sent as 1230 cents', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Description'), 'Refund');
    await user.type(screen.getByLabelText('Amount (€)'), '12,30');
    await user.click(screen.getByLabelText('Income'));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(m.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1230 })));
  });

  test.each([
    ['empty description', '', '12,30'],
    ['invalid amount', 'Coffee', '12,3,0'],
    ['zero amount', 'Coffee', '0'],
  ])('%s disables saving', async (_name, description, amount) => {
    renderForm();
    const user = userEvent.setup();
    if (description) await user.type(screen.getByLabelText('Description'), description);
    await user.type(screen.getByLabelText('Amount (€)'), amount);
    const save = screen.getByRole('button', { name: 'Save transaction' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(m.createTransaction).not.toHaveBeenCalled();
  });
});
