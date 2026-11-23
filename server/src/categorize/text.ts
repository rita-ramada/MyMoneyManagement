export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function merchantKey(description: string): string {
  let s = stripDiacritics(description).toUpperCase();
  s = s
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ')
    .replace(/\bREF\s*\d+/g, ' ')
    .replace(/\*\d+/g, ' ')
    .replace(/X{4}/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/\*/g, ' ');
  // Drop standalone all-digit tokens of any length; tokens mixing letters and digits stay.
  s = collapse(s).replace(/(^| )\d+(?= |$)/g, ' ');
  s = collapse(s);
  s = s.replace(/^(COMPRA|PAG(AMENTO)?( SERV)?|POS|DD|TPA)\b\s*/, '');
  return collapse(s);
}

export function scrubForAi(description: string): string {
  const s = description
    .replace(/\s+/g, ' ') // normalize NBSP/tabs first so later patterns see plain spaces
    .replace(/[^\s@]+@[^\s@]+/g, ' ') // emails
    // separated IBAN: each group after the first must contain a digit, so words survive
    .replace(/\b[A-Z]{2}\d{2}(?:[ .\/-]?(?=[A-Z]*\d)[A-Z0-9]{4}){2,7}(?:[ .\/-]?\d{1,4})?\b/gi, ' ')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, ' ') // compact IBAN
    // phone/NIF/reference-like: 4+ digits (any Unicode digit) joined by any run of
    // non-letter, non-digit characters. Linear: the separator class never matches a digit.
    .replace(/\+?\p{Nd}(?:[^\p{L}\p{Nd}]*\p{Nd}){3,}/gu, ' ')
    .replace(/\b(?:X{4}[ -]*)+/gi, ' ') // card masks
    .replace(/\*+\d*/g, ' ')
    .replace(/\p{Nd}{4,}/gu, ' '); // backstop
  // drop stray punctuation-only tokens left behind by removals
  return collapse(collapse(s).replace(/(^| )[-./*_]+(?= |$)/g, ' '));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isTransferLike(description: string, patterns: string[]): boolean {
  const text = stripDiacritics(description).toUpperCase();
  return patterns.some((p) => {
    const pat = stripDiacritics(p).toUpperCase().trim();
    if (!pat) return false;
    return new RegExp(`(?<![A-Z0-9])${escapeRe(pat)}(?![A-Z0-9])`).test(text);
  });
}
