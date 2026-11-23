import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BankProfile } from '@mmm/shared/src/types';
import { decodeCsvBytes, parseCsv, previewColumns } from './csv';

type Profile = Omit<BankProfile, 'id' | 'name'>;
const fixture = (n: string) =>
  readFileSync(fileURLToPath(new URL(`../../test/fixtures/${n}`, import.meta.url)), 'utf-8');

const single: Profile = {
  delimiter: ';', skipRows: 2, hasHeader: true, dateCol: 0, descriptionCols: [1],
  amountMode: 'single', amountCol: 3, debitCol: null, creditCol: null,
  dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', invertSign: false,
};
const dc: Profile = {
  ...single, skipRows: 1, amountMode: 'debitCredit', amountCol: null, debitCol: 2, creditCol: 3,
};

describe('parseCsv', () => {
  it('parses single-amount file with one footer error', () => {
    const { rows, errors } = parseCsv(fixture('sample-pt.csv'), single);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ line: 4, date: '2026-11-02', description: 'COMPRA CONTINENTE', amountCents: -4567 });
    expect(rows.some((r) => r.description.startsWith('TRANSFERÊNCIA MB WAY'))).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(11);
    expect(errors[0].reason).toMatch(/date/i);
  });

  it('handles debit/credit columns', () => {
    const { rows, errors } = parseCsv(fixture('sample-debit-credit.csv'), dc);
    expect(rows.map((r) => r.amountCents)).toEqual([-1230, 50000]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/amount/i);
  });

  it('invertSign flips every amount', () => {
    const a = parseCsv(fixture('sample-pt.csv'), single).rows;
    const b = parseCsv(fixture('sample-pt.csv'), { ...single, invertSign: true }).rows;
    expect(b.map((r) => r.amountCents)).toEqual(a.map((r) => -r.amountCents));
  });

  it('joins description columns with a single space and trims', () => {
    const { rows } = parseCsv(fixture('sample-pt.csv'), { ...single, descriptionCols: [1, 2] });
    expect(rows[0].description).toBe('COMPRA CONTINENTE LISBOA');
  });
});

describe('previewColumns', () => {
  it('returns raw cells after skipped rows', () => {
    const out = previewColumns(fixture('sample-pt.csv'), ';', 2, 2);
    expect(out).toEqual([
      ['Data', 'Descricao', 'Detalhe', 'Valor'],
      ['02/11/2026', 'COMPRA CONTINENTE', 'LISBOA', '-45,67'],
    ]);
  });
});

describe('decodeCsvBytes', () => {
  it('decodes windows-1252', () => {
    const bytes = Uint8Array.from([...'TRANSFER'].map((c) => c.charCodeAt(0)).concat([0xca], [...'NCIA'].map((c) => c.charCodeAt(0))));
    expect(decodeCsvBytes(bytes)).toBe('TRANSFERÊNCIA');
  });
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('abc')]);
    expect(decodeCsvBytes(bytes)).toBe('abc');
  });
  it('keeps UTF-8 Ê intact', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('TRANSFERÊNCIA'))).toBe('TRANSFERÊNCIA');
  });
});
