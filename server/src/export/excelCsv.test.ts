import { describe, expect, test } from 'vitest';
import { toExcelCsv } from './excelCsv';

describe('toExcelCsv', () => {
  test('quotes delimiters, formats numbers with decimal comma', () => {
    expect(toExcelCsv(['a', 'b'], [['x;y', -12.3]])).toBe('﻿a;b\r\n"x;y";-12,30\r\n');
  });
  test('doubles inner quotes and quotes newlines', () => {
    expect(toExcelCsv(['a'], [['say "hi"'], ['l1\nl2']])).toBe('﻿a\r\n"say ""hi"""\r\n"l1\nl2"\r\n');
  });
  test('header only', () => {
    expect(toExcelCsv(['a', 'b'], [])).toBe('﻿a;b\r\n');
  });
});
