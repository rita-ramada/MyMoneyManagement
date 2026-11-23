import type { Category, CategorySource } from '@mmm/shared/src/types';
import type { AiCategorizer, AiItem } from './ai';
import { isTransferLike, merchantKey, scrubForAi } from './text';

export interface CategorizeInput { key: string /* row id */; description: string; amountCents: number }
export interface CategorizeResult { categoryId: number | null; source: CategorySource }

const BATCH_SIZE = 50;

export async function categorizeRows(
  rows: CategorizeInput[],
  deps: {
    rules: Map<string, number>;
    transferPatterns: string[];
    categories: Category[];
    ai: AiCategorizer | null;
    aiEnabled: boolean;
  },
): Promise<{ results: Map<string, CategorizeResult>; aiNotice: string | null }> {
  const results = new Map<string, CategorizeResult>();
  const none: CategorizeResult = { categoryId: null, source: 'none' };
  // merchant key -> rows awaiting AI (first row supplies the description/amount)
  const pending = new Map<string, CategorizeInput[]>();

  for (const row of rows) {
    const mk = merchantKey(row.description);
    const ruleCat = mk === '' ? undefined : deps.rules.get(mk);
    if (ruleCat !== undefined) {
      results.set(row.key, { categoryId: ruleCat, source: 'rule' });
    } else if (isTransferLike(row.description, deps.transferPatterns)) {
      results.set(row.key, { ...none });
    } else {
      results.set(row.key, { ...none });
      if (mk === '') {
        // No merchant identity: never group; skip the AI when nothing but digits/symbols remains.
        if (/\p{L}/u.test(scrubForAi(row.description))) pending.set(`row:${row.key}`, [row]);
      } else {
        const group = pending.get(mk);
        if (group) group.push(row);
        else pending.set(mk, [row]);
      }
    }
  }

  if (pending.size === 0) return { results, aiNotice: null };
  if (!deps.ai || !deps.aiEnabled) {
    return { results, aiNotice: 'AI is off; uncategorized rows were left for manual categorization.' };
  }

  const groups = [...pending.values()];
  const items: AiItem[] = groups.map((g, i) => ({
    id: `m${i}`,
    description: scrubForAi(g[0].description),
    amount: g[0].amountCents / 100,
  }));
  const idByName = new Map(deps.categories.map((c) => [c.name, c.id]));
  const names = deps.categories.map((c) => c.name);

  let failed = false;
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    try {
      const answers = await deps.ai.categorize(batch, names);
      if (!(answers instanceof Map)) throw new Error('unexpected AI response');
      for (const item of batch) {
        const name = answers.get(item.id);
        const categoryId = typeof name === 'string' ? idByName.get(name) : undefined;
        if (categoryId === undefined) continue;
        for (const row of groups[Number(item.id.slice(1))]) results.set(row.key, { categoryId, source: 'ai' });
      }
    } catch {
      failed = true;
    }
  }

  return {
    results,
    aiNotice: failed ? 'AI categorization failed for some rows; they were left uncategorized.' : null,
  };
}
