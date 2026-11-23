import { describe, it, expect } from 'vitest';
import { parseAmountToCents, parseDate } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['12,30', 1230],
    ['-12,30', -1230],
    ['12,30-', -1230],
    ['(12,30)', -1230],
    ['1.234,56', 123456],
    ['€ 12,30', 1230],
    ['12,30 EUR', 1230],
    ['', null],
    ['abc', null],
  ])('parses %j with comma separator', (input, cents) => {
    expect(parseAmountToCents(input, ',')).toBe(cents);
  });

  it('parses dot decimal separator', () => {
    expect(parseAmountToCents('1,234.56', '.')).toBe(123456);
  });
});

describe('parseDate', () => {
  it('parses DD/MM/YYYY to ISO', () => {
    expect(parseDate('02/11/2026', 'DD/MM/YYYY')).toBe('2026-11-02');
  });
  it('rejects an invalid date', () => {
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
  });
});
