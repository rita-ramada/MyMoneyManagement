import { describe, expect, test } from 'vitest';
import { formatEuros, parseEurosToCents } from './format';

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formatEuros', () => {
  test('formats cents as pt-PT euros', () => {
    expect(norm(formatEuros(-123456))).toContain('1234,56');
    expect(norm(formatEuros(-123456))).toContain('€');
    expect(norm(formatEuros(-123456))).toMatch(/^-/);
  });
});

describe('parseEurosToCents', () => {
  test.each([
    ['12,30', 1230],
    ['12.30', 1230],
    ['12', 1200],
    [' 1234,5 ', 123450],
    ['-3,10', -310],
  ])('%s → %i', (input, cents) => expect(parseEurosToCents(input)).toBe(cents));

  test.each(['x', '', '12,345', '1,2,3'])('%s → null', (input) => expect(parseEurosToCents(input)).toBeNull());
});
