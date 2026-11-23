import type { Database } from 'better-sqlite3';
import type { Account, BankProfile, Category, Rule } from '@mmm/shared/src/types';

export function listCategories(db: Database): Category[] {
  return db.prepare('SELECT id, name, kind FROM categories ORDER BY id').all() as Category[];
}

export function getSetting<T>(db: Database, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: Database, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

// ---- accounts ----
type AccountInput = Omit<Account, 'id'>;
interface AccountRow {
  id: number;
  name: string;
  bank_profile_id: number | null;
  opening_balance_cents: number;
  opening_balance_date: string;
}
const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  bankProfileId: r.bank_profile_id,
  openingBalanceCents: r.opening_balance_cents,
  openingBalanceDate: r.opening_balance_date,
});

export function listAccounts(db: Database): Account[] {
  return (db.prepare('SELECT * FROM accounts ORDER BY id').all() as AccountRow[]).map(toAccount);
}
export function getAccount(db: Database, id: number): Account | undefined {
  const r = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  return r && toAccount(r);
}
export function createAccount(db: Database, a: AccountInput): Account {
  const info = db
    .prepare(
      'INSERT INTO accounts (name, bank_profile_id, opening_balance_cents, opening_balance_date) VALUES (?, ?, ?, ?)',
    )
    .run(a.name, a.bankProfileId, a.openingBalanceCents, a.openingBalanceDate);
  return getAccount(db, Number(info.lastInsertRowid))!;
}
export function updateAccount(db: Database, id: number, a: AccountInput): Account | undefined {
  const info = db
    .prepare(
      'UPDATE accounts SET name = ?, bank_profile_id = ?, opening_balance_cents = ?, opening_balance_date = ? WHERE id = ?',
    )
    .run(a.name, a.bankProfileId, a.openingBalanceCents, a.openingBalanceDate, id);
  return info.changes ? getAccount(db, id) : undefined;
}

// ---- bank profiles ----
type ProfileInput = Omit<BankProfile, 'id'>;
interface ProfileRow {
  id: number;
  name: string;
  delimiter: BankProfile['delimiter'];
  skip_rows: number;
  has_header: number;
  date_col: number;
  description_cols: string;
  amount_mode: BankProfile['amountMode'];
  amount_col: number | null;
  debit_col: number | null;
  credit_col: number | null;
  date_format: BankProfile['dateFormat'];
  decimal_separator: BankProfile['decimalSeparator'];
  invert_sign: number;
}
const toProfile = (r: ProfileRow): BankProfile => ({
  id: r.id,
  name: r.name,
  delimiter: r.delimiter,
  skipRows: r.skip_rows,
  hasHeader: r.has_header === 1,
  dateCol: r.date_col,
  descriptionCols: JSON.parse(r.description_cols) as number[],
  amountMode: r.amount_mode,
  amountCol: r.amount_col,
  debitCol: r.debit_col,
  creditCol: r.credit_col,
  dateFormat: r.date_format,
  decimalSeparator: r.decimal_separator,
  invertSign: r.invert_sign === 1,
});
const profileParams = (p: ProfileInput) => [
  p.name,
  p.delimiter,
  p.skipRows,
  p.hasHeader ? 1 : 0,
  p.dateCol,
  JSON.stringify(p.descriptionCols),
  p.amountMode,
  p.amountCol,
  p.debitCol,
  p.creditCol,
  p.dateFormat,
  p.decimalSeparator,
  p.invertSign ? 1 : 0,
];

export function listBankProfiles(db: Database): BankProfile[] {
  return (db.prepare('SELECT * FROM bank_profiles ORDER BY id').all() as ProfileRow[]).map(toProfile);
}
export function getBankProfile(db: Database, id: number): BankProfile | undefined {
  const r = db.prepare('SELECT * FROM bank_profiles WHERE id = ?').get(id) as ProfileRow | undefined;
  return r && toProfile(r);
}
export function createBankProfile(db: Database, p: ProfileInput): BankProfile {
  const info = db
    .prepare(
      `INSERT INTO bank_profiles (name, delimiter, skip_rows, has_header, date_col, description_cols,
        amount_mode, amount_col, debit_col, credit_col, date_format, decimal_separator, invert_sign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...profileParams(p));
  return getBankProfile(db, Number(info.lastInsertRowid))!;
}
export function updateBankProfile(db: Database, id: number, p: ProfileInput): BankProfile | undefined {
  const info = db
    .prepare(
      `UPDATE bank_profiles SET name = ?, delimiter = ?, skip_rows = ?, has_header = ?, date_col = ?,
        description_cols = ?, amount_mode = ?, amount_col = ?, debit_col = ?, credit_col = ?,
        date_format = ?, decimal_separator = ?, invert_sign = ? WHERE id = ?`,
    )
    .run(...profileParams(p), id);
  return info.changes ? getBankProfile(db, id) : undefined;
}
export function deleteBankProfile(db: Database, id: number): boolean {
  return db.transaction(() => {
    db.prepare('UPDATE accounts SET bank_profile_id = NULL WHERE bank_profile_id = ?').run(id);
    return db.prepare('DELETE FROM bank_profiles WHERE id = ?').run(id).changes > 0;
  })();
}

// ---- categories ----
export function createCategory(db: Database, c: Omit<Category, 'id'>): Category {
  const info = db.prepare('INSERT INTO categories (name, kind) VALUES (?, ?)').run(c.name, c.kind);
  return { id: Number(info.lastInsertRowid), ...c };
}
export function updateCategory(db: Database, id: number, c: Omit<Category, 'id'>): Category | undefined {
  const info = db.prepare('UPDATE categories SET name = ?, kind = ? WHERE id = ?').run(c.name, c.kind, id);
  return info.changes ? { id, ...c } : undefined;
}

// ---- rules ----
export function listRules(db: Database): Rule[] {
  return db
    .prepare(
      'SELECT id, merchant_key AS merchantKey, category_id AS categoryId, created_at AS createdAt FROM rules ORDER BY id',
    )
    .all() as Rule[];
}
export function deleteRule(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes > 0;
}
export function findRuleCategory(db: Database, key: string): number | null {
  if (key === '') return null;
  const r = db.prepare('SELECT category_id AS c FROM rules WHERE merchant_key = ?').get(key) as
    | { c: number }
    | undefined;
  return r ? r.c : null;
}
