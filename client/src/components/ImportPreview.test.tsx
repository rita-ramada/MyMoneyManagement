import type { Category, ImportPreview as Preview, PreviewRow, Transaction } from '@mmm/shared/src/types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import ImportPreview from './ImportPreview';

const cats: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Eating Out', kind: 'expense' },
  { id: 3, name: 'Salary', kind: 'income' },
];

const manual: Transaction = {
  id: 77, accountId: 1, date: '2026-11-03', description: 'Coffee cash', merchantKey: 'COFFEE CASH', amountCents: -1230,
  categoryId: 2, categorySource: 'manual', origin: 'manual', importBatchId: null, dedupeHash: 'm',
};

function row(p: Partial<PreviewRow> & { key: string }): PreviewRow {
  return {
    line: 1, date: '2026-11-05', description: 'X', amountCents: -100, status: 'new',
    categoryId: null, categorySource: 'none', matchedManual: null, ...p,
  };
}

const preview: Preview = {
  rows: [
    row({ key: 'L4', description: 'CONTINENTE LISBOA', categoryId: 1, categorySource: 'rule' }),
    row({ key: 'L5', description: 'NETFLIX.COM', categoryId: null, categorySource: 'none' }),
    row({ key: 'L6', description: 'UBER TRIP', status: 'duplicate', categoryId: 2, categorySource: 'manual' }),
    row({ key: 'L7', description: 'CAFE CENTRAL', amountCents: -1230, status: 'possible_manual_match', matchedManual: manual }),
  ],
  errors: [{ line: 11, raw: 'Saldo final;;;1.234,56', reason: 'Invalid date "Saldo final"' }],
  aiNotice: 'AI is off',
};

const rowEl = (text: string) => screen.getByText(text).closest('tr')!;

describe('ImportPreview', () => {
  test('a duplicate shows its stored category, is disabled and labelled, and is not counted', () => {
    render(<ImportPreview preview={preview} categories={cats} onCommit={vi.fn()} />);
    const tr = rowEl('UBER TRIP');
    const select = within(tr).getByRole('combobox', { name: /category/i });
    expect(select).toHaveValue('2');
    expect(select).toBeDisabled();
    expect(within(tr).getByText('duplicate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save 2 transactions' })).toBeInTheDocument();
  });

  test('shows the errors list and the AI notice', () => {
    render(<ImportPreview preview={preview} categories={cats} onCommit={vi.fn()} />);
    expect(screen.getByText(/Rows not imported/)).toBeInTheDocument();
    expect(screen.getByText(/Saldo final;;;1\.234,56/)).toBeInTheDocument();
    expect(screen.getByText('AI is off')).toBeInTheDocument();
  });

  test('a possible manual match shows the manual entry and defaults to skip; replace sends its id', async () => {
    const onCommit = vi.fn();
    render(<ImportPreview preview={preview} categories={cats} onCommit={onCommit} />);
    const tr = rowEl('CAFE CENTRAL');
    expect(within(tr).getByText(/Coffee cash/)).toBeInTheDocument();
    expect(within(tr).getByText(/2026-11-03/)).toBeInTheDocument();
    const action = within(tr).getByRole('combobox', { name: /action/i });
    expect(action).toHaveValue('skip');
    expect(within(action).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['skip', 'replace', 'keep_both']);

    await userEvent.selectOptions(action, 'replace');
    expect(screen.getByRole('button', { name: 'Save 3 transactions' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save 3 transactions' }));
    const sent = onCommit.mock.calls[0][0];
    expect(sent.find((r: { key: string }) => r.key === 'L7')).toMatchObject({ action: 'replace', replaceTransactionId: 77 });
  });

  test('changing a category marks only that row as manual', async () => {
    const onCommit = vi.fn();
    render(<ImportPreview preview={preview} categories={cats} onCommit={onCommit} />);
    await userEvent.selectOptions(within(rowEl('NETFLIX.COM')).getByRole('combobox', { name: /category/i }), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 transactions' }));
    const sent = onCommit.mock.calls[0][0] as { key: string }[];
    expect(sent.find((r) => r.key === 'L5')).toMatchObject({ categoryId: 2, categorySource: 'manual', action: 'save' });
    expect(sent.find((r) => r.key === 'L4')).toMatchObject({ categoryId: 1, categorySource: 'rule', action: 'save' });
    expect(sent.find((r) => r.key === 'L6')).toMatchObject({ action: 'skip' });
    expect(sent.find((r) => r.key === 'L7')).toMatchObject({ action: 'skip' });
  });
});
