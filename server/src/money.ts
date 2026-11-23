import type { BankProfile } from '@mmm/shared/src/types';

export function parseAmountToCents(raw: string, decimalSeparator: ',' | '.'): number | null {
  let s = raw.replace(/EUR|€/gi, '').replace(/\s+/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  const group = decimalSeparator === ',' ? '.' : ',';
  const normalized = s.split(group).join('').replace(decimalSeparator, '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return negative ? -cents : cents;
}

export function parseDate(raw: string, format: BankProfile['dateFormat']): string | null {
  const parts = raw.trim().split(/[-/.]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const order = format.split(/[-/.]/);
  const get = (k: string) => parts[order.indexOf(k)];
  const [y, m, d] = [Number(get('YYYY')), Number(get('MM')), Number(get('DD'))];
  if (get('YYYY').length !== 4) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
