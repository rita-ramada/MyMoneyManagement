import type { Holding, HoldingPoint } from '@mmm/shared/src/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, exportUrls, type HoldingInput, type HoldingReportRow } from '../api';
import { formatEuros, parseEurosToCents, todayIso } from '../format';
import { ErrorText, useInvalidate } from './Settings';

const TYPES: { value: Holding['type']; label: string }[] = [
  { value: 'savings_certificate', label: 'Savings certificate' },
  { value: 'etf', label: 'ETF' },
  { value: 'stock', label: 'Stock' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'savings', label: 'Savings' },
];
const typeLabel = (t: Holding['type']) => TYPES.find((x) => x.value === t)?.label ?? t;
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];
const pct = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const euroTick = (cents: number) => `${Math.round(cents / 100)} €`;
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' };

/** "2,5" → 0.025; null when not a number. */
export function parsePercent(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 1000) / 100000;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = `modal-${title.replace(/\W+/g, '-')}`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function UpdateValue({ holding, onDone }: { holding: Holding; onDone: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [value, setValue] = useState('');
  const cents = parseEurosToCents(value);
  const save = useMutation({ mutationFn: () => api.addValuation(holding.id, { date, valueCents: cents! }), onSuccess: onDone });
  return (
    <Modal title={`Update value — ${holding.name}`} onClose={onDone}>
      <form onSubmit={(e) => { e.preventDefault(); if (cents !== null && cents >= 0) save.mutate(); }}>
        <div className="row">
          <label>Date<input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Current value (€)<input aria-label="Current value (€)" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        </div>
        <ErrorText error={save.error} />
        <div className="row">
          <button type="submit" disabled={cents === null || cents < 0 || save.isPending}>Save value</button>
          <button type="button" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function Contributions({ holding }: { holding: Holding }) {
  const invalidate = useInvalidate();
  const list = useQuery({ queryKey: ['contributions', holding.id], queryFn: () => api.listContributions(holding.id) });
  const [kind, setKind] = useState<'monthly' | 'one_off'>('monthly');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(holding.startDate);
  const cents = parseEurosToCents(amount);
  const changed = () => invalidate('contributions', 'investments', 'netWorth');
  const add = useMutation({
    mutationFn: () => api.addContribution(holding.id, { kind, amountCents: cents!, effectiveFrom: from }),
    onSuccess: () => { setAmount(''); changed(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteContribution(id), onSuccess: changed });
  return (
    <>
      <h3>Money put in</h3>
      <ul className="list">
        {list.data?.map((c) => (
          <li key={c.id} className="row">
            <span>{c.kind === 'monthly' ? `${formatEuros(c.amountCents)} / month from ${c.effectiveFrom}` : `${formatEuros(c.amountCents)} once on ${c.effectiveFrom}`}</span>
            <button type="button" onClick={() => remove.mutate(c.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (cents !== null && cents >= 0) add.mutate(); }}>
        <label>
          Kind
          <select aria-label="Contribution kind" value={kind} onChange={(e) => setKind(e.target.value as 'monthly' | 'one_off')}>
            <option value="monthly">Monthly amount (from date; 0 stops it)</option>
            <option value="one_off">One-off amount</option>
          </select>
        </label>
        <label>Amount (€)<input aria-label="Contribution amount (€)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>{kind === 'monthly' ? 'From' : 'On'}<input aria-label="Contribution date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <button type="submit" disabled={cents === null || cents < 0 || add.isPending}>Add</button>
      </form>
      <ErrorText error={add.error ?? remove.error} />
    </>
  );
}

function ManageHolding({ holding, onDone }: { holding?: Holding; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(holding?.name ?? '');
  const [type, setType] = useState<Holding['type']>(holding?.type ?? 'etf');
  const [startDate, setStartDate] = useState(holding?.startDate ?? todayIso());
  const [ret, setRet] = useState(holding ? String(Math.round(holding.expectedAnnualReturn * 10000) / 100).replace('.', ',') : '');
  const rate = parsePercent(ret);
  const valid = name.trim() !== '' && rate !== null && rate >= -1 && rate <= 1;
  const changed = () => invalidate('investments', 'netWorth');
  const save = useMutation({
    mutationFn: () => {
      const body: HoldingInput = { name: name.trim(), type, startDate, expectedAnnualReturn: rate! };
      return holding ? api.updateHolding(holding.id, body) : api.createHolding(body);
    },
    onSuccess: () => { changed(); if (!holding) onDone(); },
  });
  const remove = useMutation({ mutationFn: () => api.deleteHolding(holding!.id), onSuccess: () => { changed(); onDone(); } });
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid) save.mutate(); };
  return (
    <Modal title={holding ? `Edit ${holding.name}` : 'Add holding'} onClose={onDone}>
      <form onSubmit={submit}>
        <div className="row">
          <label>Name<input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>
            Type
            <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as Holding['type'])}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Start date<input aria-label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>Expected yearly return (%)<input aria-label="Expected yearly return (%)" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} /></label>
        </div>
        <ErrorText error={save.error ?? remove.error} />
        <div className="row">
          <button type="submit" disabled={!valid || save.isPending}>Save holding</button>
          {holding && <button type="button" onClick={() => { if (window.confirm(`Delete ${holding.name} and its history?`)) remove.mutate(); }}>Delete holding</button>}
          <button type="button" onClick={onDone}>Close</button>
        </div>
      </form>
      {holding && <Contributions holding={holding} />}
    </Modal>
  );
}

function ConfirmedLabel({ row }: { row: HoldingReportRow }) {
  const vals = useQuery({ queryKey: ['valuations', row.holding.id], queryFn: () => api.listValuations(row.holding.id), enabled: !!row.latest?.confirmed });
  if (!row.latest) return <span className="muted">no data yet</span>;
  if (!row.latest.confirmed) return <span className="badge">estimated</span>;
  const last = vals.data?.filter((v) => v.date.startsWith(row.latest!.month)).at(-1);
  return <span className="badge">confirmed on {last?.date ?? row.latest.month}</span>;
}

/** Splits a series so estimated stretches can be drawn dashed and confirmed ones solid. */
export function chartPoints(series: HoldingPoint[]) {
  return series.map((p, i) => {
    const linkedToConfirmed = p.confirmed && (series[i - 1]?.confirmed || series[i + 1]?.confirmed);
    return {
      month: p.month,
      contributed: p.contributedCents,
      value: p.valueCents,
      confirmedValue: linkedToConfirmed ? p.valueCents : null,
      confirmed: p.confirmed,
    };
  });
}

function ValueChart({ rows }: { rows: HoldingReportRow[] }) {
  const [selected, setSelected] = useState(rows[0]?.holding.id);
  const row = rows.find((r) => r.holding.id === selected) ?? rows[0];
  if (!row) return null;
  const data = chartPoints(row.series);
  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Value vs money put in</h2>
        <select aria-label="Holding for chart" value={row.holding.id} onChange={(e) => setSelected(Number(e.target.value))}>
          {rows.map((r) => <option key={r.holding.id} value={r.holding.id}>{r.holding.name}</option>)}
        </select>
      </div>
      <ResponsiveContainer width="100%" height={280} initialDimension={{ width: 800, height: 280 }}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={shortMonth} stroke="var(--muted)" tickLine={false} />
          <YAxis tickFormatter={euroTick} stroke="var(--muted)" tickLine={false} axisLine={false} width={70} />
          <Tooltip
            formatter={(v: number, name: string) => [formatEuros(v), name]}
            labelFormatter={(m: string) => shortMonth(m)}
            contentStyle={tooltipStyle}
          />
          <Legend />
          <Line dataKey="contributed" name="Put in" stroke="var(--series-2)" strokeWidth={2} dot={false} type="stepAfter" />
          <Line
            dataKey="value" name="Value (dashed = estimated)" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4"
            dot={(props: { cx?: number; cy?: number; payload?: { confirmed: boolean }; index?: number }) =>
              props.payload?.confirmed
                ? <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
                : <g key={props.index} />}
          />
          <Line dataKey="confirmedValue" stroke="var(--series-1)" strokeWidth={2} dot={false} legendType="none" connectNulls={false} name="Confirmed" />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

function Donut({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <section>
      <h2>{title}</h2>
      {total === 0 ? <p className="muted">Nothing to show yet.</p> : (
        <ResponsiveContainer width="100%" height={240} initialDimension={{ width: 360, height: 240 }}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke="var(--surface)" strokeWidth={2}>
              {data.map((d, i) => <Cell key={d.name} fill={SERIES[i % SERIES.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [`${formatEuros(v)} (${pct.format(v / total)})`, n]} contentStyle={tooltipStyle} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

export default function Investments() {
  const invalidate = useInvalidate();
  const report = useQuery({ queryKey: ['investments'], queryFn: () => api.investmentsReport() });
  const [updating, setUpdating] = useState<Holding | null>(null);
  const [managing, setManaging] = useState<Holding | 'new' | null>(null);
  const rows = report.data?.holdings ?? [];
  const byHolding = rows.map((r) => ({ name: r.holding.name, value: r.latest?.valueCents ?? 0 }));
  const byType = Object.entries(rows.reduce<Record<string, number>>((acc, r) => {
    const k = typeLabel(r.holding.type);
    acc[k] = (acc[k] ?? 0) + (r.latest?.valueCents ?? 0);
    return acc;
  }, {})).map(([name, value]) => ({ name, value }));

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Investments</h1>
        <div className="row">
          <a href={exportUrls.holdings()} download>Export CSV</a>
          <button type="button" className="primary" onClick={() => setManaging('new')}>Add holding</button>
        </div>
      </div>
      <ErrorText error={report.error} />
      {report.data && rows.length === 0 && <p className="muted">No holdings yet. Add your savings certificates and ETF portfolio to start.</p>}

      <div className="cards">
        {rows.map((r) => (
          <article className="tile" key={r.holding.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{r.holding.name}</strong>
              <ConfirmedLabel row={r} />
            </div>
            <div className="label">{typeLabel(r.holding.type)}</div>
            <div className="value">{formatEuros(r.latest?.valueCents ?? 0)}</div>
            <div className="muted">Put in {formatEuros(r.latest?.contributedCents ?? 0)}</div>
            <div className={r.gainCents >= 0 ? 'positive' : 'negative'}>
              {r.gainCents >= 0 ? '+' : ''}{formatEuros(r.gainCents)} ({pct.format(r.gainPct)})
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setUpdating(r.holding)}>Update value</button>
              <button type="button" onClick={() => setManaging(r.holding)}>Manage</button>
            </div>
          </article>
        ))}
      </div>

      {rows.length > 0 && (
        <>
          <ValueChart rows={rows} />
          <div className="grid2">
            <Donut title="Split by holding" data={byHolding} />
            <Donut title="Split by type" data={byType} />
          </div>
        </>
      )}

      {updating && (
        <UpdateValue holding={updating} onDone={() => { setUpdating(null); invalidate('investments', 'valuations', 'netWorth'); }} />
      )}
      {managing && (
        <ManageHolding holding={managing === 'new' ? undefined : managing} onDone={() => setManaging(null)} />
      )}
    </div>
  );
}
