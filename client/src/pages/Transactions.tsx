import type { Transaction } from '@mmm/shared/src/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, exportUrls, type TransactionFilter } from '../api';
import AddTransactionForm from '../components/AddTransactionForm';
import CategorySelect from '../components/CategorySelect';
import { formatEuros } from '../format';
import { ErrorText, useInvalidate } from './Settings';

function filterFromParams(p: URLSearchParams): TransactionFilter {
  const cat = p.get('categoryId');
  return {
    accountId: p.get('accountId') ? Number(p.get('accountId')) : undefined,
    categoryId: cat === 'none' ? 'none' : cat ? Number(cat) : undefined,
    month: p.get('month') || undefined,
    q: p.get('q') || undefined,
  };
}

export default function Transactions() {
  const invalidate = useInvalidate();
  const [params, setParams] = useSearchParams();
  const filter = filterFromParams(params);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });
  const txs = useQuery({ queryKey: ['transactions', filter], queryFn: () => api.listTransactions(filter) });

  const changed = () => invalidate('transactions', 'spending', 'netWorth', 'rules');
  const recategorize = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number | null }) => api.updateTransaction(id, { categoryId }),
    onSuccess: changed,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteTransaction(id), onSuccess: changed });

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const accountName = (id: number) => accounts.data?.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="page">
      <h1>Transactions</h1>
      <section>
        <div className="row">
          <label>
            Account
            <select aria-label="Filter account" value={filter.accountId ?? ''} onChange={(e) => setParam('accountId', e.target.value)}>
              <option value="">All</option>
              {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            Category
            <select aria-label="Filter category" value={filter.categoryId ?? ''} onChange={(e) => setParam('categoryId', e.target.value)}>
              <option value="">All</option>
              <option value="none">Uncategorized</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Month<input aria-label="Filter month" type="month" value={filter.month ?? ''} onChange={(e) => setParam('month', e.target.value)} /></label>
          <label>Search<input aria-label="Search" value={filter.q ?? ''} onChange={(e) => setParam('q', e.target.value)} /></label>
          <a href={exportUrls.transactions(filter)} download>Export CSV</a>
          <button type="button" className="primary" disabled={!accounts.data?.length} onClick={() => setEditing('new')}>Add transaction</button>
        </div>
      </section>

      {editing && accounts.data && categories.data && (
        <section>
          <h2>{editing === 'new' ? 'Add transaction' : 'Edit transaction'}</h2>
          <AddTransactionForm
            key={editing === 'new' ? 'new' : editing.id}
            accounts={accounts.data}
            categories={categories.data}
            initial={editing === 'new' ? undefined : editing}
            onSaved={() => { setEditing(null); changed(); }}
            onCancel={() => setEditing(null)}
          />
        </section>
      )}

      <ErrorText error={txs.error ?? recategorize.error ?? remove.error} />
      <section className="table-wrap">
        {txs.data?.length === 0 && <p className="muted">No transactions match these filters.</p>}
        {!!txs.data?.length && (
          <table>
            <thead>
              <tr><th>Date</th><th>Account</th><th>Description</th><th className="num">Amount</th><th>Category</th><th /></tr>
            </thead>
            <tbody>
              {txs.data.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{accountName(t.accountId)}</td>
                  <td>{t.description}{t.origin === 'manual' && <span className="badge"> manual</span>}</td>
                  <td className={`num ${t.amountCents > 0 ? 'positive' : ''}`}>{formatEuros(t.amountCents)}</td>
                  <td>
                    <CategorySelect
                      label={`Category for ${t.description}`}
                      value={t.categoryId}
                      categories={categories.data ?? []}
                      onChange={(categoryId) => recategorize.mutate({ id: t.id, categoryId })}
                    />
                  </td>
                  <td className="row">
                    <button type="button" onClick={() => setEditing(t)}>Edit</button>
                    <button type="button" onClick={() => { if (window.confirm(`Delete "${t.description}"?`)) remove.mutate(t.id); }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
