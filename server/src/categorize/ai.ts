import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export interface AiItem { id: string; description: string; amount: number /* euros */ }

export interface AiCategorizer {
  categorize(items: AiItem[], categoryNames: string[]): Promise<Map<string, string | null>>;
}

const UNKNOWN = 'unknown';

export function createClaudeCategorizer(client: Anthropic, log?: (payload: unknown) => void): AiCategorizer {
  return {
    async categorize(items, categoryNames) {
      const out = new Map<string, string | null>(items.map((i) => [i.id, null]));
      if (items.length === 0 || categoryNames.length === 0) return out;

      const schema = z.object({
        results: z.array(z.object({ id: z.string(), category: z.enum([UNKNOWN, ...categoryNames] as [string, ...string[]]) })),
      });
      const system =
        'You categorize personal bank transactions. The user message is a JSON array of ' +
        '{id, description, amount} where amount is in euros (negative = money out). ' +
        `Assign each item exactly one category from this list: ${categoryNames.join(', ')}. ` +
        `If none clearly fits, answer "${UNKNOWN}". Return one result per item, using the same id.`;

      log?.(items);
      const res = await client.messages.parse({
        model: 'claude-haiku-5-5',
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: JSON.stringify(items) }],
        output_config: { effort: 'low', format: zodOutputFormat(schema) },
      });
      if (res.stop_reason === 'refusal' || !res.parsed_output) return out;

      for (const r of res.parsed_output.results) {
        if (out.has(r.id)) out.set(r.id, r.category === UNKNOWN ? null : r.category);
      }
      return out;
    },
  };
}
