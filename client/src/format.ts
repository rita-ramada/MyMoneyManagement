const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });

export function formatEuros(cents: number): string {
  return eur.format(cents / 100);
}

/** Accepts "12,30", "12.30", "12", "-3,10". At most 2 decimals; no thousands separators. */
export function parseEurosToCents(input: string): number | null {
  const m = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonthIso(): string {
  return todayIso().slice(0, 7);
}
