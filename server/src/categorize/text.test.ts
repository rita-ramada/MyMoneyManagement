import { describe, it, expect } from 'vitest';
import { isTransferLike, merchantKey, scrubForAi, stripDiacritics } from './text';

const defaults = ['TRF', 'TRANSF', 'MB WAY', 'MBWAY', 'SEPA', 'TRANSFERENCIA'];

describe('stripDiacritics', () => {
  it('removes accents', () => {
    expect(stripDiacritics('Café Ação')).toBe('Cafe Acao');
  });
});

describe('merchantKey', () => {
  const cases: [string, string][] = [
    ['COMPRA 1234 CONTINENTE LISBOA 02/11', 'CONTINENTE LISBOA'],
    ['Compra 1234 Continente Lisboa 15/11', 'CONTINENTE LISBOA'],
    ['NETFLIX.COM 13/11 *4321', 'NETFLIX.COM'],
    ['POS LIDL & CIA 0042', 'LIDL & CIA'],
    ['PAG SERV EDP COMERCIAL REF 123456789', 'EDP COMERCIAL'],
    ['UBER   *TRIP', 'UBER TRIP'],
    ['Café Central 12:45', 'CAFE CENTRAL'],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(merchantKey(input)).toBe(expected);
  });
});

describe('scrubForAi', () => {
  const cases: [string, string][] = [
    ['TRF PT50000201231234567890154 RENDA', 'TRF RENDA'],
    ['PAG 912345678 VODAFONE', 'PAG VODAFONE'],
    ['+351 912 345 678 LOJA', 'LOJA'],
    ['joao@mail.pt PAYPAL', 'PAYPAL'],
    ['CARD XXXX XXXX 1234 AMAZON', 'CARD AMAZON'],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    const out = scrubForAi(input);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/\d{4,}/);
    expect(out).not.toContain('@');
    expect(out).not.toContain('PT50');
  });

  it('removes space-grouped IBANs', () => {
    const out = scrubForAi('TRF PT50 0002 0123 1234 5678 9015 4 RENDA');
    expect(out).toBe('TRF RENDA');
  });

  it.each([
    ['MB WAY 912-345-678', 'MB WAY'],
    ['MB WAY 912.345.678', 'MB WAY'],
    ['PAG NIF 123-456-789 FINANCAS', 'PAG NIF FINANCAS'],
    ['PAG NIF 123.456.789 FINANCAS', 'PAG NIF FINANCAS'],
    ['PAG SERV REF 123/456/789', 'PAG SERV REF'],
    ['PAG SERV ENT 21 312 REF 12-345-678-9', 'PAG SERV ENT REF'],
    ['MB WAY 912 345 678', 'MB WAY'],
    ['MB WAY 912\t345\t678', 'MB WAY'],
    ['TRF PT50.0002.0123.1234.5678.9015.4 RENDA', 'TRF RENDA'],
    ['TRF PT50-0002-0123-1234-5678-9015-4 RENDA', 'TRF RENDA'],
  ])('separator variants: %s', (input, expected) => {
    expect(scrubForAi(input)).toBe(expected);
  });

  it('keeps non-IBAN tokens like AB12 CAFE LOJA', () => {
    expect(scrubForAi('COMPRA AB12 CAFE LOJA LISBOA')).toBe('COMPRA AB12 CAFE LOJA LISBOA');
    expect(scrubForAi('UBER EATS LX12 PORT ALEG')).toBe('UBER EATS LX12 PORT ALEG');
    expect(scrubForAi('COMPRA ab12 cafe loja')).toBe('COMPRA ab12 cafe loja');
  });

  it('never leaves a 4+ digit run (seeded property test)', () => {
    let seed = 123456789;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const alphabet = '0123456789 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij -./ \t';
    for (let i = 0; i < 200; i++) {
      const len = 1 + Math.floor(rnd() * 60);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const out = scrubForAi(s);
      expect(out).not.toMatch(/\d{4,}/);
      // also no digit group that is 4+ digits once single separators are ignored
      for (const g of out.match(/\d(?:[^A-Za-z0-9]?\d)*/g) ?? []) {
        expect(g.replace(/\D/g, '').length).toBeLessThan(4);
      }
    }
  });
});

describe('isTransferLike', () => {
  it('matches whole-word patterns', () => {
    expect(isTransferLike('Transferência MB WAY p/ Maria', defaults)).toBe(true);
    expect(isTransferLike('SEPA DD EDP', defaults)).toBe(true);
    expect(isTransferLike('TRFX COFFEE', defaults)).toBe(false);
    expect(isTransferLike('CONTINENTE', defaults)).toBe(false);
  });
  it('ignores empty patterns', () => {
    expect(isTransferLike('CONTINENTE', ['', '  '])).toBe(false);
  });
});
