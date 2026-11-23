import type { BankProfile } from '@mmm/shared/src/types';
import { useState } from 'react';
import type { ProfileInput } from '../api';

export function defaultProfile(): ProfileInput {
  return {
    name: '', delimiter: ';', skipRows: 0, hasHeader: true, dateCol: -1, descriptionCols: [],
    amountMode: 'single', amountCol: null, debitCol: null, creditCol: null,
    dateFormat: 'DD-MM-YYYY', decimalSeparator: ',', invertSign: false,
  };
}

/** Columns chosen and a name given: enough to parse. */
export function isProfileComplete(p: ProfileInput): boolean {
  const amountOk = p.amountMode === 'single' ? p.amountCol !== null : p.debitCol !== null && p.creditCol !== null;
  return p.name.trim() !== '' && p.dateCol >= 0 && p.descriptionCols.length > 0 && amountOk;
}

const DATE_FORMATS: BankProfile['dateFormat'][] = ['DD-MM-YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'];
const DELIMITERS: { value: BankProfile['delimiter']; label: string }[] = [
  { value: ';', label: 'Semicolon ;' }, { value: ',', label: 'Comma ,' }, { value: '\t', label: 'Tab' },
];

interface Props {
  cells: string[][];
  initial: ProfileInput;
  /** Called on every change, so the parent can refresh the raw cells and the parsed sample. */
  onChange: (p: ProfileInput) => void;
  onSave: (p: ProfileInput) => void;
  saving?: boolean;
}

export default function ColumnMapper({ cells, initial, onChange, onSave, saving }: Props) {
  const [p, setP] = useState<ProfileInput>(initial);
  const update = (patch: Partial<ProfileInput>) => {
    const next = { ...p, ...patch };
    setP(next);
    onChange(next);
  };
  const width = Math.max(0, ...cells.map((r) => r.length));
  const header = p.hasHeader ? cells[0] : undefined;
  const colLabel = (i: number) => `Column ${i + 1}${header?.[i] ? ` — ${header[i]}` : ''}`;
  const columnSelect = (label: string, value: number | null, set: (v: number | null) => void) => (
    <label>
      {label}
      <select aria-label={label} value={value === null || value < 0 ? '' : value} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">—</option>
        {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
      </select>
    </label>
  );

  return (
    <section>
      <h2>Map the columns</h2>
      <p className="muted">Tell the app which column holds what. This is saved for this bank, so you only do it once.</p>
      <div className="row">
        <label>Bank name<input aria-label="Bank name" value={p.name} onChange={(e) => update({ name: e.target.value })} /></label>
        <label>
          Separator
          <select aria-label="Separator" value={p.delimiter} onChange={(e) => update({ delimiter: e.target.value as BankProfile['delimiter'] })}>
            {DELIMITERS.map((d) => <option key={d.label} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label>
          Lines to skip at the top
          <input aria-label="Lines to skip" type="number" min={0} value={p.skipRows} onChange={(e) => update({ skipRows: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="row">
          <input type="checkbox" checked={p.hasHeader} onChange={(e) => update({ hasHeader: e.target.checked })} />
          First line is a header
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <tbody>
            {cells.slice(0, 6).map((r, i) => (
              <tr key={i}>{Array.from({ length: width }, (_, j) => <td key={j}><code>{r[j] ?? ''}</code></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        {columnSelect('Date column', p.dateCol, (v) => update({ dateCol: v ?? -1 }))}
        {columnSelect('Description column', p.descriptionCols[0] ?? null, (v) => update({ descriptionCols: v === null ? [] : [v, ...p.descriptionCols.slice(1).filter((c) => c !== v)] }))}
        {columnSelect('Extra description column (optional)', p.descriptionCols[1] ?? null, (v) => update({ descriptionCols: [p.descriptionCols[0], v].filter((c): c is number => c !== null && c !== undefined) }))}
        <label>
          Amount layout
          <select
            aria-label="Amount layout"
            value={p.amountMode}
            onChange={(e) => update(e.target.value === 'single'
              ? { amountMode: 'single', debitCol: null, creditCol: null }
              : { amountMode: 'debitCredit', amountCol: null })}
          >
            <option value="single">One amount column (negative = money out)</option>
            <option value="debitCredit">Separate debit and credit columns</option>
          </select>
        </label>
        {p.amountMode === 'single'
          ? columnSelect('Amount column', p.amountCol, (v) => update({ amountCol: v }))
          : (<>
            {columnSelect('Debit column', p.debitCol, (v) => update({ debitCol: v }))}
            {columnSelect('Credit column', p.creditCol, (v) => update({ creditCol: v }))}
          </>)}
      </div>

      <div className="row">
        <label>
          Date format
          <select aria-label="Date format" value={p.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as BankProfile['dateFormat'] })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Decimal separator
          <select aria-label="Decimal separator" value={p.decimalSeparator} onChange={(e) => update({ decimalSeparator: e.target.value as ',' | '.' })}>
            <option value=",">Comma (12,30)</option>
            <option value=".">Point (12.30)</option>
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={p.invertSign} onChange={(e) => update({ invertSign: e.target.checked })} />
          Flip signs (bank shows spending as positive)
        </label>
      </div>

      <p>
        <button type="button" className="primary" disabled={!isProfileComplete(p) || saving} onClick={() => onSave(p)}>
          Save bank format
        </button>
      </p>
    </section>
  );
}
