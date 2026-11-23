import Papa from 'papaparse';
import type { BankProfile, ParsedRow, RowError } from '@mmm/shared/src/types';
import { parseAmountToCents, parseDate } from '../money';

type Profile = Omit<BankProfile, 'id' | 'name'>;

export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Parses every physical line (no skipping) so array index + 1 is the original line number.
function readCells(text: string, delimiter: string): string[][] {
  return Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false }).data;
}

const isBlank = (cells: string[]) => cells.every((c) => c.trim() === '');

export function previewColumns(text: string, delimiter: Profile['delimiter'], skipRows: number, n = 5): string[][] {
  return readCells(text, delimiter)
    .slice(skipRows)
    .filter((r) => !isBlank(r))
    .slice(0, n);
}

export function parseCsv(text: string, profile: Profile): { rows: ParsedRow[]; errors: RowError[] } {
  const all = readCells(text, profile.delimiter);
  const start = profile.skipRows + (profile.hasHeader ? 1 : 0);
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = start; i < all.length; i++) {
    const cells = all[i];
    if (isBlank(cells)) continue;
    const line = i + 1;
    const raw = cells.join(profile.delimiter);
    const cell = (c: number | null) => (c === null ? '' : (cells[c] ?? '').trim());

    const date = parseDate(cell(profile.dateCol), profile.dateFormat);
    if (!date) {
      errors.push({ line, raw, reason: `Invalid date "${cell(profile.dateCol)}"` });
      continue;
    }

    let amount: number | null;
    if (profile.amountMode === 'single') {
      amount = parseAmountToCents(cell(profile.amountCol), profile.decimalSeparator);
    } else {
      const debit = parseAmountToCents(cell(profile.debitCol), profile.decimalSeparator);
      const credit = parseAmountToCents(cell(profile.creditCol), profile.decimalSeparator);
      const d = debit ? Math.abs(debit) : 0;
      const c = credit ? Math.abs(credit) : 0;
      if (d && c) {
        errors.push({ line, raw, reason: 'Ambiguous amount: both debit and credit are non-zero' });
        continue;
      }
      amount = d ? -d : c ? c : null;
    }
    if (amount === null) {
      errors.push({ line, raw, reason: 'Invalid or missing amount' });
      continue;
    }

    const description = profile.descriptionCols.map((c) => cell(c)).join(' ').replace(/\s+/g, ' ').trim();
    rows.push({ line, date, description, amountCents: profile.invertSign ? -amount : amount });
  }
  return { rows, errors };
}
