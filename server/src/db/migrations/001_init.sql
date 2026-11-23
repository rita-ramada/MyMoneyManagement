CREATE TABLE bank_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  delimiter TEXT NOT NULL CHECK (delimiter IN (',', ';', char(9))),
  skip_rows INTEGER NOT NULL DEFAULT 0,
  has_header INTEGER NOT NULL DEFAULT 1,
  date_col INTEGER NOT NULL,
  description_cols TEXT NOT NULL, -- JSON array of column indexes
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('single', 'debitCredit')),
  amount_col INTEGER,
  debit_col INTEGER,
  credit_col INTEGER,
  date_format TEXT NOT NULL CHECK (date_format IN ('DD-MM-YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY')),
  decimal_separator TEXT NOT NULL CHECK (decimal_separator IN (',', '.')),
  invert_sign INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank_profile_id INTEGER REFERENCES bank_profiles(id),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  opening_balance_date TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer'))
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  file_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  merchant_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  category_source TEXT NOT NULL DEFAULT 'none' CHECK (category_source IN ('rule', 'ai', 'manual', 'none')),
  origin TEXT NOT NULL CHECK (origin IN ('import', 'manual')),
  import_batch_id INTEGER REFERENCES import_batches(id),
  dedupe_hash TEXT NOT NULL
);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date);
CREATE INDEX idx_transactions_dedupe_hash ON transactions(dedupe_hash);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_key TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_rules_merchant_key ON rules(merchant_key);

CREATE TABLE holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('savings_certificate', 'etf', 'stock', 'crypto', 'savings')),
  start_date TEXT NOT NULL,
  expected_annual_return REAL NOT NULL
);

CREATE TABLE holding_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holding_id INTEGER NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('monthly', 'one_off')),
  amount_cents INTEGER NOT NULL,
  effective_from TEXT NOT NULL
);

CREATE TABLE holding_valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holding_id INTEGER NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value_cents INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

INSERT INTO categories (name, kind) VALUES
  ('Groceries', 'expense'),
  ('Rent/Housing', 'expense'),
  ('Utilities', 'expense'),
  ('Transport', 'expense'),
  ('Subscriptions', 'expense'),
  ('Eating Out', 'expense'),
  ('Shopping', 'expense'),
  ('Health', 'expense'),
  ('Leisure', 'expense'),
  ('Travel', 'expense'),
  ('Fees', 'expense'),
  ('Other', 'expense'),
  ('Salary', 'income'),
  ('Other Income', 'income'),
  ('Transfer', 'transfer'),
  ('Investing', 'transfer');

INSERT INTO settings (key, value) VALUES
  ('transferPatterns', '["TRF","TRANSF","MB WAY","MBWAY","SEPA","TRANSFERENCIA"]'),
  ('aiEnabled', 'true');
