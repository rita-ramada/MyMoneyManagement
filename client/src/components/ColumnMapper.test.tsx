import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import ColumnMapper, { defaultProfile } from './ColumnMapper';

const cells = [
  ['Data', 'Descrição', 'Débito', 'Crédito'],
  ['02/11/2026', 'CONTINENTE', '12,30', ''],
];

describe('ColumnMapper', () => {
  test('debit/credit mode hides the amount column and needs both columns before saving', async () => {
    const onSave = vi.fn();
    render(<ColumnMapper cells={cells} initial={{ ...defaultProfile(), name: 'My bank' }} onChange={vi.fn()} onSave={onSave} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Date column'), '0');
    await user.selectOptions(screen.getByLabelText('Description column'), '1');
    expect(screen.getByLabelText('Amount column')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Amount layout'), 'debitCredit');
    expect(screen.queryByLabelText('Amount column')).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save bank format' });
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Debit column'), '2');
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Credit column'), '3');
    expect(save).toBeEnabled();

    await user.click(save);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'My bank', amountMode: 'debitCredit', amountCol: null, debitCol: 2, creditCol: 3, dateCol: 0, descriptionCols: [1],
    }));
  });
});
