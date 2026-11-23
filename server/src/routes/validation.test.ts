import { describe, expect, test } from 'vitest';
import { isoDate, isoMonth } from './validation';

describe('isoDate', () => {
  test.each(['2026-01-31', '2024-02-29'])('accepts %s', (s) => {
    expect(isoDate.safeParse(s).success).toBe(true);
  });
  test.each(['2026-13-45', '2026-02-31', '2025-02-29', '2026-1-1', 'not-a-date', ''])('rejects %s', (s) => {
    expect(isoDate.safeParse(s).success).toBe(false);
  });
});

describe('isoMonth', () => {
  test.each(['2026-01', '2026-12'])('accepts %s', (s) => {
    expect(isoMonth.safeParse(s).success).toBe(true);
  });
  test.each(['2026-00', '2026-13', '2026-1', '2026-01-01'])('rejects %s', (s) => {
    expect(isoMonth.safeParse(s).success).toBe(false);
  });
});
