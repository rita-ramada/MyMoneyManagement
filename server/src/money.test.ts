import { describe, expect, it, test } from 'vitest';
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

describe('parseDate with a time part (final review I2)', () => {
  test.each([
    ['2026-11-02 10:22:33', 'YYYY-MM-DD', '2026-11-02'],
    ['2026-11-02T10:22:33', 'YYYY-MM-DD', '2026-11-02'],
    ['02/11/2026 10:22', 'DD/MM/YYYY', '2026-11-02'],
  ] as const)('%s → %s', (raw, fmt, iso) => expect(parseDate(raw, fmt)).toBe(iso));
});
