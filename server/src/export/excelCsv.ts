const BOM = '﻿';

function field(v: string | number): string {
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',');
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV that opens correctly in Excel with a pt-PT locale: BOM, `;` delimiter, CRLF, decimal comma. */
export function toExcelCsv(header: string[], rows: (string | number)[][]): string {
  return BOM + [header, ...rows].map((r) => `${r.map(field).join(';')}\r\n`).join('');
}
