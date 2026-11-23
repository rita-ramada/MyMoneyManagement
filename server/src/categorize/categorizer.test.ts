import { describe, expect, it, vi } from 'vitest';
import type { Category } from '@mmm/shared/src/types';
import type { AiCategorizer, AiItem } from './ai';
import { categorizeRows } from './categorizer';
import { merchantKey, scrubForAi } from './text';

const categories: Category[] = [
  { id: 1, name: 'Streaming', kind: 'expense' },
  { id: 2, name: 'Groceries', kind: 'expense' },
];

function fakeAi(answer: (item: AiItem) => string | null = () => 'Streaming') {
  const calls: AiItem[][] = [];
  const ai: AiCategorizer = {
    async categorize(items) {
      calls.push(items);
      return new Map(items.map((i) => [i.id, answer(i)]));
    },
  };
  return { ai, calls };
}

const base = { rules: new Map<string, number>(), transferPatterns: ['TRF'], categories, aiEnabled: true };
const none = { categoryId: null, source: 'none' };

describe('categorizeRows', () => {
  it('applies rules and does not send them to the AI', async () => {
    const { ai, calls } = fakeAi();
    const rules = new Map([[merchantKey('PINGO DOCE 123456'), 2]]);
    const { results } = await categorizeRows([{ key: 'r1', description: 'PINGO DOCE 123456', amountCents: -500 }], { ...base, rules, ai });
    expect(results.get('r1')).toEqual({ categoryId: 2, source: 'rule' });
    expect(calls).toHaveLength(0);
  });

  it('guards transfer-like rows', async () => {
    const { ai, calls } = fakeAi();
    const { results } = await categorizeRows([{ key: 'r1', description: 'TRF to savings', amountCents: -500 }], { ...base, ai });
    expect(results.get('r1')).toEqual(none);
    expect(calls).toHaveLength(0);
  });

  it('dedupes by merchant key, scrubs, converts to euros, exact keys', async () => {
    const { ai, calls } = fakeAi();
    const rows = [
      { key: 'r1', description: 'NETFLIX 12345678 ref 99', amountCents: -1399 },
      { key: 'r2', description: 'NETFLIX 87654321', amountCents: -1399 },
    ];
    const { results, aiNotice } = await categorizeRows(rows, { ...base, ai });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    const item = calls[0][0];
    expect(Object.keys(item).sort()).toEqual(['amount', 'description', 'id']);
    expect(item.description).toBe(scrubForAi(rows[0].description));
    expect(item.amount).toBe(-13.99);
    expect(item.id).not.toBe('r1');
    expect(results.get('r1')).toEqual({ categoryId: 1, source: 'ai' });
    expect(results.get('r2')).toEqual({ categoryId: 1, source: 'ai' });
    expect(aiNotice).toBeNull();
  });

  it('batches at most 50 items per call', async () => {
    const { ai, calls } = fakeAi();
    const letters = 'ABCDEFGHIJKL';
    const rows = Array.from({ length: 120 }, (_, i) => ({
      key: `r${i}`,
      description: `SHOP ${letters[i % 12]}${letters[Math.floor(i / 12) % 12]}${letters[Math.floor(i / 144)]} STORE`,
      amountCents: -100,
    }));
    await categorizeRows(rows, { ...base, ai });
    expect(calls.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it('treats off-list, null and unknown ids as none', async () => {
    const answers: Record<string, string | null> = { ALPHA: 'Nope', BETA: null, GAMMA: 'Groceries' };
    const ai: AiCategorizer = {
      async categorize(items) {
        const m = new Map<string, string | null>(items.map((i) => [i.id, answers[i.description]]));
        m.set('bogus', 'Groceries');
        return m;
      },
    };
    const rows = ['ALPHA', 'BETA', 'GAMMA'].map((d) => ({ key: d, description: d, amountCents: -100 }));
    const { results } = await categorizeRows(rows, { ...base, ai });
    expect(results.get('ALPHA')).toEqual(none);
    expect(results.get('BETA')).toEqual(none);
    expect(results.get('GAMMA')).toEqual({ categoryId: 2, source: 'ai' });
    expect(results.size).toBe(3);
  });

  it('survives a throwing AI', async () => {
    const ai: AiCategorizer = { async categorize() { throw new Error('boom'); } };
    const { results, aiNotice } = await categorizeRows([{ key: 'r1', description: 'NETFLIX', amountCents: -100 }], { ...base, ai });
    expect(results.get('r1')).toEqual(none);
    expect(aiNotice).toMatch(/AI categorization failed/);
  });

  it('survives a wrong-shaped AI response', async () => {
    const ai = { async categorize() { return undefined; } } as unknown as AiCategorizer;
    const { results } = await categorizeRows([{ key: 'r1', description: 'NETFLIX', amountCents: -100 }], { ...base, ai });
    expect(results.get('r1')).toEqual(none);
  });

  it('reports AI off when null or disabled', async () => {
    const row = [{ key: 'r1', description: 'NETFLIX', amountCents: -100 }];
    const a = await categorizeRows(row, { ...base, ai: null });
    expect(a.aiNotice).toMatch(/AI is off/);
    expect(a.results.get('r1')).toEqual(none);
    const { ai, calls } = fakeAi();
    const b = await categorizeRows(row, { ...base, ai, aiEnabled: false });
    expect(b.aiNotice).toMatch(/AI is off/);
    expect(calls).toHaveLength(0);
  });

  describe('empty merchant keys', () => {
    const empties = ['COMPRA 4521 XXXX 1234 12/11', '123456789', 'TPA *1234', 'PAG SERV 12345 REF 998877'];

    it('never matches a rule with an empty key', async () => {
      const rules = new Map([['', 2]]);
      for (const description of empties) expect(merchantKey(description)).toBe('');
      const rows = empties.map((d, i) => ({ key: `r${i}`, description: d, amountCents: -100 }));
      const { results } = await categorizeRows(rows, { ...base, rules, ai: null });
      for (const r of rows) expect(results.get(r.key)).toEqual(none);
    });

    it('sends letter-bearing empty-key rows as separate items with their own answers', async () => {
      const answers: Record<string, string> = { 'COMPRA': 'Streaming', 'PAG SERV REF': 'Groceries' };
      const { ai, calls } = fakeAi((i) => answers[i.description] ?? null);
      const rows = [
        { key: 'a', description: 'COMPRA 4521 XXXX 1234 12/11', amountCents: -100 },
        { key: 'b', description: 'PAG SERV 12345 REF 998877', amountCents: -200 },
      ];
      const { results } = await categorizeRows(rows, { ...base, ai });
      expect(calls[0]).toHaveLength(2);
      expect(results.get('a')).toEqual({ categoryId: 1, source: 'ai' });
      expect(results.get('b')).toEqual({ categoryId: 2, source: 'ai' });
    });

    it('does not send digits-only rows to the AI', async () => {
      const { ai, calls } = fakeAi();
      const { results } = await categorizeRows([{ key: 'r', description: '123456789', amountCents: -100 }], { ...base, ai });
      expect(calls).toHaveLength(0);
      expect(results.get('r')).toEqual(none);
    });
  });
});

describe('AI failure diagnostics (final review I7)', () => {
  it('logs the error type and HTTP status, never the request content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class AuthenticationError extends Error { status = 401; }
    const ai: AiCategorizer = { categorize: async () => { throw new AuthenticationError('invalid x-api-key NETFLIX'); } };
    const { aiNotice } = await categorizeRows(
      [{ key: 'r1', description: 'NETFLIX.COM 4321 JOAO', amountCents: -1399 }],
      { rules: new Map(), transferPatterns: [], categories, ai, aiEnabled: true },
    );
    expect(aiNotice).toMatch(/AI categorization failed/);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].join(' ');
    expect(logged).toContain('AuthenticationError');
    expect(logged).toContain('401');
    expect(logged).not.toMatch(/NETFLIX|JOAO|4321|x-api-key/);
    warn.mockRestore();
  });
});
