import type { Account, CategoryKind } from '@mmm/shared/src/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { formatEuros, parseEurosToCents, todayIso } from '../format';

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function ErrorText({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{(error as Error).message}</p> : null;
}

function EditAccount({ account, onDone }: { account: Account; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(account.name);
  const [balance, setBalance] = useState((account.openingBalanceCents / 100).toFixed(2).replace('.', ','));
  const [date, setDate] = useState(account.openingBalanceDate);
  const cents = parseEurosToCents(balance);
  const save = useMutation({
    mutationFn: () => api.updateAccount(account.id, {
      name: name.trim(), bankProfileId: account.bankProfileId, openingBalanceCents: cents!, openingBalanceDate: date,
    }),
    onSuccess: () => { invalidate('accounts', 'netWorth'); onDone(); },
  });
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim() && cents !== null) save.mutate(); }}>
      <label>Name<input aria-label="Edit account name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Opening balance (€)<input aria-label="Edit opening balance (€)" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
      <label>On<input aria-label="Edit opening balance date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <button type="submit" disabled={!name.trim() || cents === null || save.isPending}>Save account</button>
      <button type="button" onClick={onDone}>Cancel</button>
      <ErrorText error={save.error} />
    </form>
  );
}

function Accounts() {
  const invalidate = useInvalidate();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayIso());
  const cents = parseEurosToCents(balance || '0');
  const create = useMutation({
    mutationFn: (v: Parameters<typeof api.createAccount>[0]) => api.createAccount(v),
    onSuccess: () => { setName(''); setBalance(''); invalidate('accounts'); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || cents === null) return;
    create.mutate({ name: name.trim(), bankProfileId: null, openingBalanceCents: cents, openingBalanceDate: date });
  };
  return (
    <section>
      <h2>Accounts</h2>
      <ul className="list">
        {accounts.data?.map((a) => (
          editing === a.id
            ? <li key={a.id}><EditAccount account={a} onDone={() => setEditing(null)} /></li>
            : (
              <li key={a.id} className="row">
                <span>{a.name} — opening {formatEuros(a.openingBalanceCents)} on {a.openingBalanceDate}</span>
                <button type="button" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a.id)}>Edit</button>
              </li>
            )
        ))}
      </ul>
      <form onSubmit={submit} className="row">
        <label>Account name<input aria-label="Account name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Opening balance (€)<input aria-label="Opening balance (€)" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label>Opening balance date<input aria-label="Opening balance date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="submit" disabled={!name.trim() || cents === null || create.isPending}>Add account</button>
      </form>
      <p className="muted">The opening balance is what the account held at the start of that day, before any transactions on it.</p>
      <ErrorText error={create.error} />
    </section>
  );
}

function BankProfiles() {
  const invalidate = useInvalidate();
  const profiles = useQuery({ queryKey: ['bankProfiles'], queryFn: api.listBankProfiles });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => {
      const { id: _id, ...rest } = profiles.data!.find((x) => x.id === id)!;
      return api.updateBankProfile(id, { ...rest, name });
    },
    onSuccess: () => invalidate('bankProfiles'),
  });
  const remove = useMutation({ mutationFn: (v: Parameters<typeof api.deleteBankProfile>[0]) => api.deleteBankProfile(v), onSuccess: () => invalidate('bankProfiles', 'accounts') });
  return (
    <section>
      <h2>Bank formats</h2>
      {profiles.data?.length === 0 && <p className="muted">None yet. One is saved the first time you import a CSV from a bank.</p>}
      <ul className="list">
        {profiles.data?.map((p) => (
          <li key={p.id} className="row">
            <span>{p.name}</span>
            <button type="button" onClick={() => { const n = window.prompt('New name', p.name); if (n?.trim()) rename.mutate({ id: p.id, name: n.trim() }); }}>Rename</button>
            <button type="button" onClick={() => { if (window.confirm(`Delete bank format "${p.name}"?`)) remove.mutate(p.id); }}>Delete</button>
          </li>
        ))}
      </ul>
      <ErrorText error={rename.error ?? remove.error} />
    </section>
  );
}

const KINDS: CategoryKind[] = ['expense', 'income', 'transfer'];

function Categories() {
  const invalidate = useInvalidate();
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const create = useMutation({ mutationFn: (v: Parameters<typeof api.createCategory>[0]) => api.createCategory(v), onSuccess: () => { setName(''); invalidate('categories'); } });
  const update = useMutation({
    mutationFn: ({ id, ...c }: { id: number; name: string; kind: CategoryKind }) => api.updateCategory(id, c),
    onSuccess: () => invalidate('categories'),
  });
  return (
    <section>
      <h2>Categories</h2>
      <ul className="list">
        {categories.data?.map((c) => (
          <li key={c.id} className="row">
            <span>{c.name}</span>
            <select aria-label={`Kind of ${c.name}`} value={c.kind} onChange={(e) => update.mutate({ id: c.id, name: c.name, kind: e.target.value as CategoryKind })}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" onClick={() => { const n = window.prompt('New name', c.name); if (n?.trim()) update.mutate({ id: c.id, name: n.trim(), kind: c.kind }); }}>Rename</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate({ name: name.trim(), kind }); }}>
        <label>New category<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <select aria-label="New category kind" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="submit" disabled={!name.trim()}>Add category</button>
      </form>
      <p className="muted">Transfer categories are left out of income and expense totals.</p>
      <ErrorText error={create.error ?? update.error} />
    </section>
  );
}

function Rules() {
  const invalidate = useInvalidate();
  const rules = useQuery({ queryKey: ['rules'], queryFn: api.listRules });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });
  const remove = useMutation({ mutationFn: (v: Parameters<typeof api.deleteRule>[0]) => api.deleteRule(v), onSuccess: () => invalidate('rules') });
  const catName = (id: number) => categories.data?.find((c) => c.id === id)?.name ?? '?';
  return (
    <section>
      <h2>Learned rules</h2>
      {rules.data?.length === 0 && <p className="muted">No rules yet. Correcting a category creates one.</p>}
      <ul className="list">
        {rules.data?.map((r) => (
          <li key={r.id} className="row">
            <span><code>{r.merchantKey}</code> → {catName(r.categoryId)}</span>
            <button type="button" onClick={() => remove.mutate(r.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AiAndPatterns() {
  const invalidate = useInvalidate();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [pattern, setPattern] = useState('');
  const update = useMutation({ mutationFn: (v: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(v), onSuccess: () => invalidate('settings') });
  const s = settings.data;
  if (!s) return null;
  return (
    <section>
      <h2>AI categorization</h2>
      <p>{s.aiConfigured ? 'API key configured.' : 'No API key — add it to .env (ANTHROPIC_API_KEY) and restart.'}</p>
      <label className="row">
        <input type="checkbox" checked={s.aiEnabled} onChange={(e) => update.mutate({ aiEnabled: e.target.checked })} />
        Use AI for transactions no rule covers
      </label>
      <h3>Transfer patterns</h3>
      <p className="muted">Descriptions matching these words are never sent to the AI, because they usually contain names.</p>
      <ul className="list">
        {s.transferPatterns.map((p) => (
          <li key={p} className="row">
            <code>{p}</code>
            <button type="button" onClick={() => update.mutate({ transferPatterns: s.transferPatterns.filter((x) => x !== p) })}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        const p = pattern.trim().toUpperCase();
        if (p && !s.transferPatterns.includes(p)) update.mutate({ transferPatterns: [...s.transferPatterns, p] });
        setPattern('');
      }}>
        <label>New pattern<input value={pattern} onChange={(e) => setPattern(e.target.value)} /></label>
        <button type="submit" disabled={!pattern.trim()}>Add pattern</button>
      </form>
      <ErrorText error={update.error} />
    </section>
  );
}

function Backup() {
  const backup = useMutation({ mutationFn: () => api.backup() });
  return (
    <section>
      <h2>Backup</h2>
      <button type="button" onClick={() => backup.mutate()} disabled={backup.isPending}>Back up database</button>
      {backup.data && <p>Saved to <code>{backup.data.file}</code></p>}
      <ErrorText error={backup.error} />
    </section>
  );
}

export default function Settings() {
  return (
    <div className="page">
      <h1>Settings</h1>
      <Accounts />
      <BankProfiles />
      <Categories />
      <Rules />
      <AiAndPatterns />
      <Backup />
    </div>
  );
}
