import type { Category, CategoryKind } from '@mmm/shared/src/types';

const GROUPS: { kind: CategoryKind; label: string }[] = [
  { kind: 'expense', label: 'Expenses' },
  { kind: 'income', label: 'Income' },
  { kind: 'transfer', label: 'Transfers' },
];

interface Props {
  value: number | null;
  onChange: (id: number | null) => void;
  categories: Category[];
  allowNone?: boolean;
  disabled?: boolean;
  label?: string;
  id?: string;
}

export default function CategorySelect({ value, onChange, categories, allowNone = true, disabled, id, label }: Props) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      {allowNone && <option value="">Uncategorized</option>}
      {GROUPS.map((g) => {
        const items = categories.filter((c) => c.kind === g.kind);
        return items.length === 0 ? null : (
          <optgroup key={g.kind} label={g.label}>
            {items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}
