import type { Account, Category, Transaction } from '@mmm/shared/src/types';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { parseEurosToCents, todayIso } from '../format';
import CategorySelect from './CategorySelect';

interface Props {
  accounts: Account[];
  categories: Category[];
  initial?: Transaction;
  onSaved: () => void;
  onCancel?: () => void;
}

function centsToInput(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2).replace('.', ',');
}

export default function AddTransactionForm({ accounts, categories, initial, onSaved, onCancel }: Props) {
  const [accountId, setAccountId] = useState<number>(initial?.accountId ?? accounts[0]?.id ?? 0);
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : '');
  const [isIncome, setIsIncome] = useState(initial ? initial.amountCents > 0 : false);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  // Once the user picks a category (or we're editing one), suggestions never override it.
  const userPicked = useRef(initial !== undefined);

  useEffect(() => {
    if (userPicked.current || !description.trim()) return;
    let live = true;
    const t = setTimeout(() => {
      api.suggestCategory(description)
        .then((r) => { if (live && !userPicked.current && r.categoryId !== null) setCategoryId(r.categoryId); })
        .catch(() => { /* a missing suggestion is fine */ });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [description]);

  const parsed = parseEurosToCents(amount);
  const cents = parsed === null || parsed <= 0 ? null : isIncome ? parsed : -parsed;
  const valid = description.trim() !== '' && cents !== null && accountId > 0;

  const save = useMutation({
    mutationFn: () => {
      const body = { date, description: description.trim(), amountCents: cents!, categoryId };
      return initial ? api.updateTransaction(initial.id, body) : api.createTransaction({ accountId, ...body });
    },
    onSuccess: () => onSaved(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <div className="row">
        <label>
          Account
          <select aria-label="Account" value={accountId} disabled={!!initial} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Date<input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>Description<input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label>Amount (€)<input aria-label="Amount (€)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <div className="row" role="radiogroup" aria-label="Type">
        <label className="row"><input type="radio" name="kind" aria-label="Expense" checked={!isIncome} onChange={() => setIsIncome(false)} />Expense</label>
        <label className="row"><input type="radio" name="kind" aria-label="Income" checked={isIncome} onChange={() => setIsIncome(true)} />Income</label>
        <label>
          Category
          <CategorySelect
            id="tx-category"
            label="Category"
            value={categoryId}
            categories={categories}
            onChange={(id) => { userPicked.current = true; setCategoryId(id); }}
          />
        </label>
      </div>
      {save.error && <p className="error" role="alert">{(save.error as Error).message}</p>}
      <div className="row">
        <button type="submit" disabled={!valid || save.isPending}>Save transaction</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
