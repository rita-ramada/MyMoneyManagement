import { describe, it, expect } from 'vitest';
import { descriptionHash, markDuplicates, matchManualEntries } from './dedupe';

describe('markDuplicates', () => {
  it('marks the first M occurrences as duplicates', () => {
    expect(markDuplicates(['a', 'a', 'a', 'b'], new Map([['a', 2]]))).toEqual([true, true, false, false]);
  });
});

describe('descriptionHash', () => {
  it('normalizes case and whitespace', () => {
    expect(descriptionHash(1, '2026-11-05', -1230, 'Continente  Lisboa')).toBe(
      descriptionHash(1, '2026-11-05', -1230, 'CONTINENTE LISBOA'),
    );
  });
  it('strips diacritics', () => {
    expect(descriptionHash(1, '2026-11-05', -1, 'Café')).toBe(descriptionHash(1, '2026-11-05', -1, 'CAFE'));
  });
  it('differs by account', () => {
    expect(descriptionHash(1, '2026-11-05', -1230, 'X')).not.toBe(descriptionHash(2, '2026-11-05', -1230, 'X'));
  });
});

describe('matchManualEntries', () => {
  const row = (date: string, amountCents = -1230) => ({ date, amountCents });
  const man = (id: number, date: string, amountCents = -1230) => ({ id, date, amountCents });
  it('matches within 3 days', () => {
    expect(matchManualEntries([row('2026-11-05')], [man(7, '2026-11-03')])).toEqual([7]);
  });
  it('does not match 4 days apart', () => {
    expect(matchManualEntries([row('2026-11-05')], [man(7, '2026-11-01')])).toEqual([null]);
  });
  it('does not match different amount', () => {
    expect(matchManualEntries([row('2026-11-05')], [man(7, '2026-11-05', -999)])).toEqual([null]);
  });
  it('two rows one manual: closest row wins', () => {
    expect(matchManualEntries([row('2026-11-01'), row('2026-11-04')], [man(7, '2026-11-05')])).toEqual([null, 7]);
  });
  it('tie: earliest row wins', () => {
    expect(matchManualEntries([row('2026-11-04'), row('2026-11-06')], [man(7, '2026-11-05')])).toEqual([7, null]);
  });
  it('one row two manuals: closest manual, each used once', () => {
    expect(matchManualEntries([row('2026-11-05')], [man(1, '2026-11-02'), man(2, '2026-11-04')])).toEqual([2]);
  });
  it('is not affected by DST', () => {
    expect(matchManualEntries([row('2026-03-30')], [man(1, '2026-03-27')])).toEqual([1]);
  });
});
