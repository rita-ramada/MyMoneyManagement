import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeCategorizer } from './ai';

function stubClient(res: unknown) {
  const parse = vi.fn().mockResolvedValue(res);
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const items = [
  { id: 'm0', description: 'NETFLIX', amount: -13.99 },
  { id: 'm1', description: 'PINGO DOCE', amount: -42.5 },
];

describe('createClaudeCategorizer', () => {
  it('sends the expected request and maps results', async () => {
    const { client, parse } = stubClient({
      stop_reason: 'end_turn',
      parsed_output: { results: [{ id: 'm0', category: 'Streaming' }, { id: 'm1', category: 'Groceries' }] },
    });
    const log = vi.fn();
    const out = await createClaudeCategorizer(client, log).categorize(items, ['Streaming', 'Groceries']);
    expect(out.get('m0')).toBe('Streaming');
    expect(out.get('m1')).toBe('Groceries');
    const req = parse.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.output_config.effort).toBe('low');
    expect(req.output_config.format).toBeDefined();
    expect(JSON.parse(req.messages[0].content)).toEqual(items);
    expect(req.system).toContain('Streaming');
    expect(req.system).toContain('Groceries');
    expect(req.system).toContain('unknown');
    expect(log).toHaveBeenCalledWith(items);
  });

  it('maps everything to null on refusal', async () => {
    const { client } = stubClient({ stop_reason: 'refusal', parsed_output: { results: [{ id: 'm0', category: 'Streaming' }] } });
    const out = await createClaudeCategorizer(client).categorize(items, ['Streaming']);
    expect([...out.entries()]).toEqual([['m0', null], ['m1', null]]);
  });

  it('maps everything to null when parsed_output is null', async () => {
    const { client } = stubClient({ stop_reason: 'end_turn', parsed_output: null });
    const out = await createClaudeCategorizer(client).categorize(items, ['Streaming']);
    expect([...out.entries()]).toEqual([['m0', null], ['m1', null]]);
  });

  it('maps unknown to null and missing ids to null', async () => {
    const { client } = stubClient({ stop_reason: 'end_turn', parsed_output: { results: [{ id: 'm0', category: 'unknown' }] } });
    const out = await createClaudeCategorizer(client).categorize(items, ['Streaming']);
    expect(out.get('m0')).toBeNull();
    expect(out.get('m1')).toBeNull();
  });
});
