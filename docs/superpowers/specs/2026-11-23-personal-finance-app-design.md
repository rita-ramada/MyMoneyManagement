# MyMoneyManagement — Design (v1)

Date: 2026-11-23
Status: awaiting approval

## 1. Intent

A personal finance app for one person, running only on their own Windows PC. It answers two questions:

- **Where does my money go?** Import bank transactions, have them categorized automatically (learning from my corrections), and see spending by category and over time.
- **How are my savings and investments doing?** Track what I put in vs what it is worth, and my net worth over time.

Privacy is the overriding concern: these are real bank records. Data stays on the machine; the only thing that ever leaves is a scrubbed transaction description and amount sent to the AI for categorization.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
- Import bank CSVs from any bank via a saved, per-bank column mapping, with a full preview before saving.
- Add, edit and delete single transactions by hand.
- Auto-categorize: learned rules first, AI second, "Uncategorized" when unsure. Manual corrections create rules for future imports.
- Spending dashboard: monthly expenses by category, month-over-month comparison, top merchants, income vs expenses.
- Investments dashboard: per-holding contributions vs value, returns over time, allocation split.
- Net worth over time (bank accounts + investments).
- Multiple bank accounts.
- Export transactions to CSV.

**Non-goals (v1, explicitly later)**
- PDF import (later: a second importer feeding the same preview screen).
- Budgets and over-budget warnings.
- Automatic recurring/subscription detection.
- Savings goals.
- Live market prices, broker integrations, per-trade investment tracking.
- Multi-user, auth, cloud sync, mobile.

**Anti-goals (failure even if it "works")**
- Any account number, IBAN, card number, or person's name leaving the machine.
- The API key appearing in frontend code, the browser, logs, or git.
- Imported data saved without the user seeing a preview first.
- Silent re-categorization of past transactions.
- The server being reachable from other machines on the network.

## 3. Constraints

- Windows 11, single user, runs locally.
- React frontend (user requirement).
- Local database; no data in any cloud service other than the AI call described below.
- Bank CSV formats vary (separators, date formats, decimal comma vs point, single amount vs debit/credit columns, header rows).
- Currency: EUR only in v1.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | React (Vite + TypeScript) frontend + Node.js/Express backend on localhost + SQLite | One language, minimal setup, easy to change; runs in the browser rather than as an installed app. |
| B | React + Python/FastAPI backend + SQLite | Strong data/CSV tooling and easier future PDF parsing, but two languages and toolchains on Windows. |
| C | Desktop app (Electron or Tauri) | Native window and icon, but packaging/updates add real complexity (Tauri adds Rust) with no privacy or feature gain over A. |

**Picked: A.** It fits "React, for me only, on my machine" with the fewest moving parts; it can be wrapped as a desktop app later if wanted.

## 5. Architecture

```
Browser (React, http://localhost:5173 in dev)
   │  JSON over HTTP (no secrets)
   ▼
Node/Express server  ── bound to 127.0.0.1 only
   ├── SQLite file (data/finance.db)
   ├── Categorizer: rules → scrubber → AI client
   └── .env (ANTHROPIC_API_KEY)  ── never sent to the browser
            │  scrubbed description + amount only
            ▼
        Claude API (claude-haiku-5-5)
```

- Repo layout: npm workspaces — `client/` (React), `server/` (Express), `shared/` (TypeScript types shared by both).
- Server listens on `127.0.0.1` only. No auth needed because it is not reachable from the network.
- `data/` and `.env` are git-ignored. A `.env.example` documents the variables.
- Start with one command (`npm start` builds the client and serves it from Express on one port) plus a `start.bat` for double-click launching.
- Libraries: `better-sqlite3` with plain SQL + a simple numbered-migrations folder; `papaparse` for CSV; `recharts` for charts; `@anthropic-ai/sdk` for the AI; Vitest for tests.

## 6. Data model

- **accounts**: id, name, bank_profile_id (nullable, so an account like "Cash" can exist with manual entries only), opening_balance, opening_balance_date.
- **bank_profiles**: id, name, column mapping (date / description / amount, or debit + credit), date format, decimal separator, CSV delimiter, rows to skip, sign convention.
- **categories**: id, name, kind (`expense` | `income` | `transfer`). Seeded defaults: Groceries, Rent/Housing, Utilities, Transport, Subscriptions, Eating Out, Shopping, Health, Leisure, Travel, Fees, Other (expense); Salary, Other Income (income); Transfer, Investing (transfer). The user can add and rename categories.
- **transactions**: id, account_id, date, description (original, full text — stays local), merchant_key (normalized), amount (signed, negative = money out), category_id (nullable = Uncategorized), category_source (`rule` | `ai` | `manual` | `none`), origin (`import` | `manual`), import_batch_id (null for manual entries), dedupe_hash.
- **rules**: id, merchant_key, category_id, created_at. One rule per merchant_key; a newer correction overwrites it.
- **import_batches**: id, account_id, file_name, imported_at, row counts.
- **holdings**: id, name, type (`savings_certificate` | `etf` | `stock` | `crypto` | `savings` — only the "manual monthly" model in v1), start_date, expected_annual_return.
- **holding_contributions**: id, holding_id, amount_per_month, effective_from (lets the monthly amount change over time; also allows one-off lump sums as a separate row type `one_off` with a date).
- **holding_valuations**: id, holding_id, date, value (real values entered by the user).

## 7. CSV import flow

1. **Upload** a CSV and choose the target account.
2. **Column mapping** — first time only for that bank. The user marks the date, description and amount (or debit and credit) columns, plus the date format and decimal separator. The app shows a live parsed sample so the user can see if the mapping is right. Saved as a bank profile; later imports with that profile skip this step.
3. **Preview table** of every parsed row: date, description, amount, proposed category with its source (rule / AI / none).
   - Rows already in the database are marked **duplicate**: shown with the category they already have, excluded from saving.
   - The user can change any category in the preview (counts as a manual correction → creates/updates a rule).
   - Rows that fail to parse are listed separately with the reason; they are not saved.
4. **Save** inserts the non-duplicate rows in one database transaction and records an import batch. Nothing is written before this step.

**Duplicate detection**: `dedupe_hash = hash(account_id, date, amount, normalized description)`. To avoid collapsing genuine same-day repeats (two identical coffees), compare by count: if the file has N rows with a given hash and the DB already has M, the first M are duplicates and the rest are new.

**Matching manual entries:** a hand-typed description rarely matches the bank's text exactly, so manual entries are also checked differently. If an imported row has the same account and amount as a manual entry dated within ±3 days, and that manual entry hasn't already been matched, the preview marks the row **possible duplicate of manual entry** and shows both side by side. The user chooses per row: *skip* (keep the manual entry, the default), *replace* (save the bank row and delete the manual entry), or *keep both*.

## 7a. Adding a single transaction

- An **"Add transaction"** button on the transactions page opens a small form: account, date (default today), description, amount, expense/income toggle, category.
- **Category suggestion:** as the description is typed, the app looks for a matching rule (by merchant_key) and pre-selects that category. The AI is never called for manual entries: the user is right there to pick.
- Saved immediately with `origin = manual` and `category_source = manual` (or `rule` if the suggestion was kept unchanged). Choosing a category here also creates/updates the rule, the same as a correction.
- Any transaction can be edited (date, description, amount, category) or deleted from the transactions page. Deleting asks for confirmation.
- Manual transactions count everywhere imported ones do: dashboards, net worth, export.

## 8. Categorization

Order for each new (non-duplicate) row:

1. **Rules.** Compute `merchant_key` from the description. If a rule exists for that key, use its category (`source = rule`).
2. **Transfers to people are never sent to the AI.** If the description matches transfer patterns (e.g. `TRF`, `TRANSF`, `MB WAY`, `SEPA`, `TRANSFERENCIA` — kept in a configurable list), mark the row Uncategorized for the user to decide. These lines usually contain personal names.
3. **AI.** Remaining unique merchant keys are sent in batches (up to ~50 per request) with *only* the scrubbed description and the amount. The model must choose from the current category list or answer `unknown`, using structured output. `unknown` or anything off-list → Uncategorized (`source = none`).
4. If the API key is missing or the call fails, the import still works: rows stay Uncategorized and the preview says why.

**merchant_key normalization**: uppercase; remove dates, times, long digit runs, card-masking patterns (`*1234`, `XXXX`), and reference codes; collapse whitespace; trim common prefixes such as `COMPRA`, `PAG`, `POS`. Example: `COMPRA 1234 CONTINENTE LISBOA 02/11` → `CONTINENTE LISBOA`.

**Scrubber (applied before any AI call, unit-tested):**
- Drop any IBAN-like pattern, any run of 4+ digits, email addresses, phone numbers, card-masking patterns.
- The AI request contains no account names, account numbers, the user's name, dates or balances: only `{id, description, amount}`.
- The server logs the exact payload it sends at debug level, so the user can check what leaves the machine.

**Corrections:** changing a category on a transaction (in the preview or later) updates only that transaction, sets `source = manual`, and creates or updates the rule for its merchant_key. Past transactions are never changed automatically.

## 9. Spending dashboard

Filter: month picker (default: latest month with data) and account filter (all / one account).

- **Expenses by category** for the selected month (bar chart, sorted).
- **Month-over-month:** each category vs the previous month (amount and change), plus a 12-month trend of total expenses.
- **Top merchants:** top 10 merchant_keys by spend in the month.
- **Income vs expenses:** monthly bars for the last 12 months, with net (saved) per month.
- **Uncategorized count** with a link to a list to fix them.

Rule: categories of kind `transfer` (Transfer, Investing) are excluded from income and expense totals, so moving money between your own accounts or into Trading 212 isn't counted as spending. Investing is shown separately as "invested this month".

A transactions page lists all transactions with search, filters (account, category, month) and inline category edit.

## 10. Investments (v1 model: manual monthly)

Each holding has a start date, a monthly contribution schedule (plus optional one-off amounts), and an expected annual return set by the user. The user's initial setup: two Certificados de Aforro and one Trading 212 ETF portfolio.

**Estimated value**, computed month by month:
- Start of month: `value += contribution for that month`
- End of month: `value *= (1 + annual_rate) ^ (1/12)`
- If the user entered a real valuation for that month, that value replaces the estimate, and the estimate continues from it in later months.

**Dashboard:**
- Per-holding cards: total put in, current value (labelled *estimated* or *confirmed on <date>*), gain in € and %.
- Value vs contributions over time (line chart; estimated segments drawn dashed, confirmed points marked).
- Allocation split by holding and by type (donut).
- An "update value" action per holding to enter a real value for a date.

Designed for extension: `holdings.type` plus a valuation strategy per holding, so per-trade tracking, broker CSV import or live prices can be added later as new strategies without changing this one.

## 11. Net worth

- Account balance at month end = `opening_balance + sum(transactions from opening_balance_date to that month end)`.
- Net worth at month end = all account balances + each holding's (confirmed or estimated) value.
- Chart: monthly net worth, stacked by bank accounts vs investments, from the earliest opening balance date.

## 12. Export

- Transactions to CSV (respects the current filters): date, account, description, amount, category.
- Holdings summary to CSV: holding, contributed, value, value date, estimated/confirmed.
- UTF-8 with BOM and `;` delimiter with decimal comma, so it opens correctly in Portuguese-locale Excel.

## 13. Settings page

Accounts (add/edit, opening balance), bank profiles (edit or delete mappings), categories (add/rename), rules (view and delete), transfer-pattern list, AI on/off toggle, and a "Backup database" button that copies `finance.db` to a dated file.

## 14. Testing

- Unit tests (Vitest): CSV parsing with each mapping option (decimal comma, debit/credit, skipped header rows), merchant_key normalization, scrubber (must never pass IBANs, long digit runs or emails), dedupe counting, manual-entry matching (±3 days, same amount, one match per entry), investment estimation with and without valuations, net worth calculation.
- AI client tested with a mocked SDK. There are no live API calls in tests.
- A sample anonymized CSV fixture in `server/test/fixtures/`.

## 15. Left to the builder

- Exact UI styling and layout (clean, desktop-first, light/dark is a nice-to-have).
- Exact prompt wording for categorization, within the constraints in §8.
- API route design between client and server.
- Migration mechanism details.
