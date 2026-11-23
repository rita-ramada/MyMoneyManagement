import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { formatEuros } from '../format';
import { ErrorText } from './Settings';

const shortMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const euroTick = (cents: number) => `${Math.round(cents / 100)} €`;

export default function NetWorth() {
  const series = useQuery({ queryKey: ['netWorth'], queryFn: () => api.netWorth() });
  const data = series.data ?? [];
  const latest = data.at(-1);
  return (
    <div className="page">
      <h1>Net worth</h1>
      <ErrorText error={series.error} />
      {series.data && data.length === 0 && <p className="muted">Add an account with an opening balance in Settings to start.</p>}
      {latest && (
        <>
          <div className="tiles">
            <div className="tile"><div className="label">Net worth</div><div className="value">{formatEuros(latest.totalCents)}</div></div>
            <div className="tile"><div className="label">Bank accounts</div><div className="value">{formatEuros(latest.bankCents)}</div></div>
            <div className="tile"><div className="label">Investments</div><div className="value">{formatEuros(latest.investmentsCents)}</div></div>
          </div>
          <section>
            <h2>Over time</h2>
            <ResponsiveContainer width="100%" height={320} initialDimension={{ width: 800, height: 320 }}>
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tickFormatter={shortMonth} stroke="var(--muted)" tickLine={false} />
                <YAxis tickFormatter={euroTick} stroke="var(--muted)" tickLine={false} axisLine={false} width={80} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatEuros(v), name]}
                  labelFormatter={(m: string) => shortMonth(m)}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
                <Legend />
                <Area type="monotone" dataKey="bankCents" name="Bank accounts" stackId="nw" stroke="var(--series-1)" fill="var(--series-1)" fillOpacity={0.35} strokeWidth={2} />
                <Area type="monotone" dataKey="investmentsCents" name="Investments" stackId="nw" stroke="var(--series-2)" fill="var(--series-2)" fillOpacity={0.35} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </section>
        </>
      )}
    </div>
  );
}
