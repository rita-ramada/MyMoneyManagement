import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { formatEuros } from '../format';
import { ErrorText } from './Settings';

export function deltaLabel(cents: number, prevCents: number): string {
  if (prevCents === 0) return cents > 0 ? 'new' : '—';
  const pct = Math.round(((cents - prevCents) / prevCents) * 100);
  if (pct === 0) return '0%';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
}

const shortMonth = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const euroTick = (cents: number) => `${Math.round(cents / 100)} €`;

function Tile({ id, label, cents, children }: { id: string; label: string; cents?: number; children?: React.ReactNode }) {
  return (
    <div className="tile" data-testid={`tile-${id}`}>
      <div className="label">{label}</div>
      <div className="value">{cents !== undefined ? formatEuros(cents) : children}</div>
    </div>
  );
}

export default function Spending() {
  const [month, setMonth] = useState<string | undefined>();
  const [accountId, setAccountId] = useState<number | undefined>();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const report = useQuery({ queryKey: ['spending', month, accountId], queryFn: () => api.spendingReport(month, accountId) });
  const r = report.data;
  const maxCat = Math.max(1, ...(r?.byCategory.map((c) => c.cents) ?? []));

  return (
    <div className="page">
      <h1>Spending</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        <label>Month<input aria-label="Month" type="month" value={month ?? r?.month ?? ''} onChange={(e) => setMonth(e.target.value || undefined)} /></label>
        <label>
          Account
          <select aria-label="Account" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All accounts</option>
            {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <ErrorText error={report.error} />

      {r && (
        <>
          <div className="tiles">
            <Tile id="expenses" label="Expenses" cents={r.totalExpenseCents} />
            <Tile id="income" label="Income" cents={r.totalIncomeCents} />
            <Tile id="net" label="Net (saved)" cents={r.totalIncomeCents - r.totalExpenseCents} />
            <Tile id="invested" label="Invested this month" cents={r.investedCents} />
            {r.uncategorizedCount > 0 && (
              <Tile id="uncategorized" label="Needs a category">
                <Link to={`/transactions?categoryId=none&month=${r.month}`}>{r.uncategorizedCount} uncategorized</Link>
              </Tile>
            )}
          </div>

          <div className="grid2">
            <section>
              <h2>Expenses by category</h2>
              {r.byCategory.length === 0 && <p className="muted">No expenses this month.</p>}
              <div className="hbars">
                {r.byCategory.map((c) => (
                  <div className="hbar" key={c.categoryId ?? 'none'} title={`${c.name}: ${formatEuros(c.cents)} (last month ${formatEuros(c.prevCents)})`}>
                    <span className="hbar-label">{c.name}</span>
                    <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(c.cents / maxCat) * 100}%` }} /></span>
                    <span className="num">{formatEuros(c.cents)}</span>
                    <span className="muted hbar-delta" data-testid={`delta-${c.name}`}>{deltaLabel(c.cents, c.prevCents)}</span>
                  </div>
                ))}
              </div>
              <p className="muted">Change is against the previous month.</p>
            </section>

            <section>
              <h2>Top merchants</h2>
              <table>
                <thead><tr><th>Merchant</th><th className="num">Spent</th><th className="num">Payments</th></tr></thead>
                <tbody>
                  {r.topMerchants.map((mm) => (
                    <tr key={mm.merchantKey}><td>{mm.merchantKey}</td><td className="num">{formatEuros(mm.cents)}</td><td className="num">{mm.count}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section>
            <h2>Income vs expenses — last 12 months</h2>
            <ResponsiveContainer width="100%" height={280} initialDimension={{ width: 800, height: 280 }}>
              <ComposedChart data={r.last12} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tickFormatter={shortMonth} stroke="var(--muted)" tickLine={false} />
                <YAxis tickFormatter={euroTick} stroke="var(--muted)" tickLine={false} axisLine={false} width={70} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatEuros(v), name]}
                  labelFormatter={(m: string) => shortMonth(m)}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
                <Legend />
                <Bar dataKey="incomeCents" name="Income" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenseCents" name="Expenses" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
                <Line dataKey="netCents" name="Net" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </section>
        </>
      )}
    </div>
  );
}
