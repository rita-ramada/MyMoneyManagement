import type { Database } from 'better-sqlite3';
import type { Account, BankProfile, Category, Rule, Transaction } from '@mmm/shared/src/types';

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

// ---- transactions & import ----
interface TransactionRow {
  id: number;
  account_id: number;
  date: string;
  description: string;
  merchant_key: string;
  amount_cents: number;
  category_id: number | null;
  category_source: Transaction['categorySource'];
  origin: Transaction['origin'];
  import_batch_id: number | null;
  dedupe_hash: string;
}
const toTransaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  date: r.date,
  description: r.description,
  merchantKey: r.merchant_key,
  amountCents: r.amount_cents,
  categoryId: r.category_id,
  categorySource: r.category_source,
  origin: r.origin,
  importBatchId: r.import_batch_id,
  dedupeHash: r.dedupe_hash,
});

export function getTransaction(db: Database, id: number): Transaction | undefined {
  const r = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
  return r && toTransaction(r);
}

/** Stored transactions of an account per dedupe hash, oldest first. */
export function transactionsByHash(db: Database, accountId: number, hashes: string[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  const unique = [...new Set(hashes)];
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const rows = db
      .prepare(
        `SELECT * FROM transactions WHERE account_id = ? AND dedupe_hash IN (${part.map(() => '?').join(',')}) ORDER BY id`,
      )
      .all(accountId, ...part) as TransactionRow[];
    for (const r of rows) {
      const list = out.get(r.dedupe_hash) ?? [];
      list.push(toTransaction(r));
      out.set(r.dedupe_hash, list);
    }
  }
  return out;
}

export function listManualTransactions(db: Database, accountId: number, from: string, to: string): Transaction[] {
  return (
    db
      .prepare(
        "SELECT * FROM transactions WHERE account_id = ? AND origin = 'manual' AND date >= ? AND date <= ? ORDER BY date, id",
      )
      .all(accountId, from, to) as TransactionRow[]
  ).map(toTransaction);
}

export function insertTransaction(db: Database, t: Omit<Transaction, 'id'>): number {
  const info = db
    .prepare(
      `INSERT INTO transactions (account_id, date, description, merchant_key, amount_cents, category_id,
        category_source, origin, import_batch_id, dedupe_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.accountId, t.date, t.description, t.merchantKey, t.amountCents, t.categoryId,
      t.categorySource, t.origin, t.importBatchId, t.dedupeHash,
    );
  return Number(info.lastInsertRowid);
}

export function deleteTransaction(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM transactions WHERE id = ?').run(id).changes > 0;
}

export function categoryExists(db: Database, id: number): boolean {
  return db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id) !== undefined;
}

export function upsertRule(db: Database, merchantKey: string, categoryId: number): void {
  db.prepare(
    `INSERT INTO rules (merchant_key, category_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(merchant_key) DO UPDATE SET category_id = excluded.category_id`,
  ).run(merchantKey, categoryId, new Date().toISOString());
}

export function createImportBatch(
  db: Database,
  b: { accountId: number; fileName: string; rowsTotal: number; rowsImported: number; rowsDuplicate: number },
): number {
  const info = db
    .prepare(
      `INSERT INTO import_batches (account_id, file_name, imported_at, rows_total, rows_imported, rows_duplicate, rows_failed)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(b.accountId, b.fileName, new Date().toISOString(), b.rowsTotal, b.rowsImported, b.rowsDuplicate);
  return Number(info.lastInsertRowid);
}

export interface TransactionFilter {
  accountId?: number;
  /** A category id, or 'none' for uncategorized rows. */
  categoryId?: number | 'none';
  month?: string;
  /** Inclusive date bounds (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Case-insensitive substring of the description. */
  q?: string;
}

/** Newest first. */
export function listTransactions(db: Database, f: TransactionFilter): Transaction[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.accountId !== undefined) { where.push('account_id = ?'); args.push(f.accountId); }
  if (f.categoryId === 'none') where.push('category_id IS NULL');
  else if (f.categoryId !== undefined) { where.push('category_id = ?'); args.push(f.categoryId); }
  if (f.month !== undefined) { where.push('substr(date, 1, 7) = ?'); args.push(f.month); }
  if (f.from !== undefined) { where.push('date >= ?'); args.push(f.from); }
  if (f.to !== undefined) { where.push('date <= ?'); args.push(f.to); }
  const sql = `SELECT * FROM transactions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, id DESC`;
  let list = (db.prepare(sql).all(...args) as TransactionRow[]).map(toTransaction);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((t) => t.description.toLowerCase().includes(q));
  }
  return list;
}

export type TransactionPatch = Partial<
  Pick<Transaction, 'date' | 'description' | 'merchantKey' | 'amountCents' | 'categoryId' | 'categorySource' | 'dedupeHash'>
>;

export function updateTransaction(db: Database, id: number, p: TransactionPatch): Transaction | undefined {
  const cols: Record<keyof TransactionPatch, string> = {
    date: 'date', description: 'description', merchantKey: 'merchant_key', amountCents: 'amount_cents',
    categoryId: 'category_id', categorySource: 'category_source', dedupeHash: 'dedupe_hash',
  };
  const keys = (Object.keys(p) as (keyof TransactionPatch)[]).filter((k) => p[k] !== undefined);
  if (keys.length > 0) {
    db.prepare(`UPDATE transactions SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => p[k] as string | number | null), id);
  }
  return getTransaction(db, id);
}

/** Latest `YYYY-MM` that has a transaction, optionally for one account. */
export function latestTransactionMonth(db: Database, accountId?: number): string | undefined {
  const row = (accountId === undefined
    ? db.prepare('SELECT max(substr(date, 1, 7)) AS m FROM transactions').get()
    : db.prepare('SELECT max(substr(date, 1, 7)) AS m FROM transactions WHERE account_id = ?').get(accountId)) as { m: string | null };
  return row.m ?? undefined;
}
