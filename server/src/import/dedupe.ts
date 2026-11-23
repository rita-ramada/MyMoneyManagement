import { createHash } from 'node:crypto';
import { stripDiacritics } from '../categorize/text';

const MAX_DAY_DIFF = 3;
const MS_PER_DAY = 86_400_000;

export function descriptionHash(accountId: number, date: string, amountCents: number, description: string): string {
  const normalized = stripDiacritics(description).toUpperCase().replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(`${accountId}|${date}|${amountCents}|${normalized}`).digest('hex');
}

/** true = duplicate. The first M occurrences (input order) of a hash with M existing rows are duplicates. */
export function markDuplicates(hashes: string[], existingCounts: Map<string, number>): boolean[] {
  const seen = new Map<string, number>();
  return hashes.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n < (existingCounts.get(h) ?? 0);
  });
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
}

export function matchManualEntries(
  rows: { date: string; amountCents: number }[],
  manual: { id: number; date: string; amountCents: number }[],
): (number | null)[] {
  const pairs: { diff: number; row: number; man: number }[] = [];
  rows.forEach((r, ri) => {
    manual.forEach((m, mi) => {
      if (m.amountCents !== r.amountCents) return;
      const diff = Math.abs(dayNumber(r.date) - dayNumber(m.date));
      if (diff <= MAX_DAY_DIFF) pairs.push({ diff, row: ri, man: mi });
    });
  });
  pairs.sort((a, b) => a.diff - b.diff || a.row - b.row || a.man - b.man);
  const result: (number | null)[] = rows.map(() => null);
  const usedManual = new Set<number>();
  for (const p of pairs) {
    if (result[p.row] !== null || usedManual.has(p.man)) continue;
    result[p.row] = manual[p.man].id;
    usedManual.add(p.man);
  }
  return result;
}
