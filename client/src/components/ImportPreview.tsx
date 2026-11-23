import type { Category, CategorySource, CommitRow, ImportPreview as Preview, PreviewRow } from '@mmm/shared/src/types';
import { useState } from 'react';
import { formatEuros } from '../format';
import CategorySelect from './CategorySelect';

type Action = CommitRow['action'];
interface RowState { categoryId: number | null; categorySource: CategorySource; action: Action }

const SOURCE_LABEL: Record<CategorySource, string> = { rule: 'rule', ai: 'AI', manual: 'you', none: '—' };
const COUNTED: Action[] = ['save', 'replace', 'keep_both'];

function initialState(r: PreviewRow): RowState {
  return {
    categoryId: r.categoryId,
    categorySource: r.categorySource,
    action: r.status === 'new' ? 'save' : 'skip',
  };
}

interface Props {
  preview: Preview;
  categories: Category[];
  onCommit: (rows: CommitRow[]) => void;
  saving?: boolean;
}

export default function ImportPreview({ preview, categories, onCommit, saving }: Props) {
  const [state, setState] = useState<Record<string, RowState>>(
    () => Object.fromEntries(preview.rows.map((r) => [r.key, initialState(r)])),
  );
  const set = (key: string, patch: Partial<RowState>) => setState((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  const count = preview.rows.filter((r) => COUNTED.includes(state[r.key].action)).length;

  const commit = () => onCommit(preview.rows.map((r) => {
    const s = state[r.key];
    const out: CommitRow = {
      key: r.key, date: r.date, description: r.description, amountCents: r.amountCents,
      categoryId: s.categoryId, categorySource: s.categorySource, action: s.action,
    };
    if (s.action === 'replace' && r.matchedManual) out.replaceTransactionId = r.matchedManual.id;
    return out;
  }));

  return (
    <div>
      {preview.aiNotice && <p className="banner">{preview.aiNotice}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Category</th><th>Source</th><th>Status</th></tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => {
              const s = state[r.key];
              return (
                <tr key={r.key} className={r.status === 'duplicate' ? 'dim' : undefined}>
                  <td>{r.date}</td>
                  <td>{r.description}</td>
                  <td className={`num ${r.amountCents < 0 ? '' : 'positive'}`}>{formatEuros(r.amountCents)}</td>
                  <td>
                    <CategorySelect
                      label={`Category for ${r.description}`}
                      value={s.categoryId}
                      categories={categories}
                      disabled={r.status === 'duplicate'}
                      onChange={(categoryId) => set(r.key, { categoryId, categorySource: categoryId === null ? 'none' : 'manual' })}
                    />
                  </td>
                  <td><span className="badge">{SOURCE_LABEL[s.categorySource]}</span></td>
                  <td>
                    {r.status === 'new' && <span className="badge">new</span>}
                    {r.status === 'duplicate' && <span className="badge">duplicate</span>}
                    {r.status === 'possible_manual_match' && r.matchedManual && (
                      <div>
                        <div className="muted">
                          Possible duplicate of your entry “{r.matchedManual.description}” on {r.matchedManual.date}
                        </div>
                        <select
                          aria-label={`Action for ${r.description}`}
                          value={s.action}
                          onChange={(e) => set(r.key, { action: e.target.value as Action })}
                        >
                          <option value="skip">Skip (keep my entry)</option>
                          <option value="replace">Replace my entry</option>
                          <option value="keep_both">Keep both</option>
                        </select>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview.errors.length > 0 && (
        <section>
          <h3>Rows not imported ({preview.errors.length})</h3>
          <ul className="list">
            {preview.errors.map((e) => (
              <li key={e.line}>Line {e.line}: <code>{e.raw}</code> <span className="muted">— {e.reason}</span></li>
            ))}
          </ul>
        </section>
      )}

      <p>
        <button type="button" className="primary" disabled={count === 0 || saving} onClick={commit}>
          {`Save ${count} transaction${count === 1 ? '' : 's'}`}
        </button>
      </p>
    </div>
  );
}
