# MyMoneyManagement v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only personal finance web app: CSV + manual transaction entry with privacy-preserving AI categorization, spending dashboard, manual-model investments dashboard, net worth, CSV export.

**Architecture:** npm-workspaces monorepo. `server/` is an Express app bound to 127.0.0.1 that owns the SQLite file, the API key and all business logic (pure functions, unit-tested). `client/` is a React SPA that talks to `/api/*` only. `shared/` holds the TypeScript types both sides use.

**Tech Stack:** Node 22 LTS, TypeScript, Express 5, better-sqlite3, papaparse, zod, @anthropic-ai/sdk, tsx; React 18 + Vite, react-router-dom, @tanstack/react-query, recharts; Vitest (+ @testing-library/react, jsdom on the client).

**Spec:** `docs/superpowers/specs/2026-11-23-personal-finance-app-design.md`

## Global Constraints

- Server listens on host `127.0.0.1` only (default port `4321`, env `PORT`). Never `0.0.0.0`.
- API key read only from server env `ANTHROPIC_API_KEY` (loaded from `.env` via `process.loadEnvFile` if present). Never sent to the client, never logged.
- `data/`, `.env` are git-ignored; `.env.example` committed.
- Money is stored and passed around as **integer cents** (`amountCents`, negative = money out). Euros only at the AI boundary and in the UI/export.
- Dates are ISO strings `YYYY-MM-DD`; months are `YYYY-MM`.
- Currency: EUR only. UI text and CSV headers in English; numbers and currency formatted with the `pt-PT` locale (`1234,56 €`).
- AI model: `claude-haiku-5-5`. AI payload items are exactly `{ id, description, amount }` with `description` scrubbed. No dates, account info or balances.
- Transfer-pattern rows and manual entries are never sent to the AI.
- Import writes nothing to the DB before the commit call.
- Past transactions are never re-categorized automatically.
- Tests never call the live API.
- Category kinds: `expense` | `income` | `transfer`. `transfer` categories are excluded from income/expense totals.

## Review Focus

1. **Bank CSV encoding:** Portuguese bank CSVs are often Windows-1252, not UTF-8 ("TRANSFERÊNCIA" must not become "TRANSFER�NCIA"). Decode as UTF-8 (strip BOM), and fall back to windows-1252 if UTF-8 decoding is invalid. Test in Task 3.
2. **Amount formats:** `1.234,56`, `-12,30`, `12,30-`, `(12,30)`, `€ 12,30`, and empty debit/credit cells must parse correctly or produce a row error, never NaN. Test in Task 3.
3. **Junk rows:** blank lines, "Saldo final"/totals footer rows and rows with unparseable dates go to `errors` with a reason and never crash the import or reach the preview as transactions. Test in Task 3.
4. **AI answers that don't match the request:** ids that weren't sent, missing ids, off-list categories or a `refusal` stop reason all result in Uncategorized (`source: 'none'`) for the affected rows and never throw. Test in Task 6.
5. **Gaps in time:** months with no transactions, a holding starting mid-month, a valuation dated mid-month, and the first month before any data must produce zero-filled continuous series, not missing points. Tests in Tasks 10, 11, 12.

---

## File Structure

```
package.json                 workspaces, root scripts (dev, start, test)
.gitignore  .env.example  start.bat
shared/src/types.ts          all DTOs shared by client and server
server/
  src/index.ts               reads env, opens DB, createApp, listen 127.0.0.1
  src/app.ts                 createApp(deps) → express app (routes mounted, static client in prod)
  src/db/db.ts               openDb(path) + migrations runner
  src/db/migrations/001_init.sql
  src/db/repo.ts             typed SQL helpers (accounts, profiles, categories, rules, tx, holdings, settings)
  src/money.ts               parseAmountToCents, centsToEuros, formatting helpers
  src/import/csv.ts          decodeCsvBytes, parseCsv(profile)
  src/import/dedupe.ts       descriptionHash, markDuplicates, matchManualEntries
  src/categorize/text.ts     merchantKey, scrubForAi, isTransferLike, stripDiacritics
  src/categorize/ai.ts       AiCategorizer interface + createClaudeCategorizer
  src/categorize/categorizer.ts  categorizeRows
  src/reports/spending.ts    spendingSummary
  src/reports/investments.ts estimateHoldingSeries
  src/reports/netWorth.ts    netWorthSeries
  src/export/excelCsv.ts     toExcelCsv
  src/routes/{setup,import,transactions,reports,holdings,admin}.ts
client/
  src/main.tsx  src/App.tsx  src/api.ts  src/format.ts
  src/pages/{Spending,Transactions,Import,Investments,NetWorth,Settings}.tsx
  src/components/{ImportPreview,ColumnMapper,AddTransactionForm,CategorySelect}.tsx
```

Tests live next to the source as `*.test.ts(x)`. Run with `npm test -w server -- <file>` / `npm test -w client -- <file>`.

---

### Task 1: Monorepo scaffold, server skeleton, client shell

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `start.bat`, `tsconfig.base.json`
- Create: `shared/package.json`, `shared/src/types.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/app.ts`
- Create: `client/` via Vite React-TS template, `client/vite.config.ts` (proxy `/api` → `http://127.0.0.1:4321`)
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(deps: AppDeps): express.Express` where `AppDeps = { db: Database; ai: AiCategorizer | null; clientDistDir?: string }`. Task 1 uses `db: unknown` until Task 2 provides the type; later tasks add routers here.
- Produces: `startServer(port: number): http.Server` in `index.ts`, always `app.listen(port, '127.0.0.1')`.

- [ ] **Step 1:** Create root `package.json` with `"private": true`, `"workspaces": ["shared","server","client"]`, scripts `dev` (server `tsx watch` + `vite` concurrently via `npm-run-all2`), `start` (`npm run build -w client && npm run start -w server`), `test` (`npm test --workspaces`). `.gitignore`: `node_modules/ data/ .env dist/ client/dist/`. `.env.example`: `ANTHROPIC_API_KEY=` and `PORT=4321`. `start.bat`: `cd /d %~dp0 && npm start`, then `start http://127.0.0.1:4321`.
- [ ] **Step 2: Write the failing test** `server/src/app.test.ts`:

```ts
import request from 'supertest';
test('GET /api/health returns ok', async () => {
  const app = createApp({ db: null as any, ai: null });
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
test('server binds to 127.0.0.1 only', async () => {
  const server = startServer(0);
  await once(server, 'listening');
  expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
  server.close();
});
```

- [ ] **Step 3: Run** `npm test -w server -- src/app.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `createApp` (express.json with a `5mb` limit, `GET /api/health`, and serves `clientDistDir` statically with SPA fallback when provided) and `startServer`. `index.ts` calls `process.loadEnvFile()` inside try/catch, then `startServer(Number(process.env.PORT ?? 4321))`.
- [ ] **Step 5: Run** the tests. Expected: PASS. Also run `npm run dev` and check that the Vite page loads at `http://localhost:5173`.
- [ ] **Step 6: Commit** `chore: scaffold monorepo with localhost-only express server and vite client`

---

### Task 2: Database, migrations, seed data

**Files:**
- Create: `server/src/db/db.ts`, `server/src/db/migrations/001_init.sql`, `server/src/db/repo.ts`
- Modify: `shared/src/types.ts`
- Test: `server/src/db/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Database` (better-sqlite3; `':memory:'` in tests). Enables `foreign_keys`, `journal_mode = WAL` for files, and applies every `migrations/NNN_*.sql` not yet listed in a `migrations` table, each in its own transaction.
- Produces: shared types (used by every later task):

```ts
type CategoryKind = 'expense' | 'income' | 'transfer';
type CategorySource = 'rule' | 'ai' | 'manual' | 'none';
interface Category { id: number; name: string; kind: CategoryKind }
interface Account { id: number; name: string; bankProfileId: number | null; openingBalanceCents: number; openingBalanceDate: string }
interface BankProfile { id: number; name: string; delimiter: ',' | ';' | '\t'; skipRows: number; hasHeader: boolean;
  dateCol: number; descriptionCols: number[]; amountMode: 'single' | 'debitCredit';
  amountCol: number | null; debitCol: number | null; creditCol: number | null;
  dateFormat: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
  decimalSeparator: ',' | '.'; invertSign: boolean }
interface Transaction { id: number; accountId: number; date: string; description: string; merchantKey: string;
  amountCents: number; categoryId: number | null; categorySource: CategorySource;
  origin: 'import' | 'manual'; importBatchId: number | null; dedupeHash: string }
interface Rule { id: number; merchantKey: string; categoryId: number; createdAt: string }
interface Holding { id: number; name: string; type: 'savings_certificate' | 'etf' | 'stock' | 'crypto' | 'savings';
  startDate: string; expectedAnnualReturn: number /* 0.025 = 2.5% */ }
interface HoldingContribution { id: number; holdingId: number; kind: 'monthly' | 'one_off'; amountCents: number; effectiveFrom: string }
interface HoldingValuation { id: number; holdingId: number; date: string; valueCents: number }
```

- Produces: `repo.ts` with one small function per query that later routes need (`listCategories(db)`, `insertTransactions(db, rows)`, `upsertRule(db, merchantKey, categoryId)`, `getSetting<T>(db, key, fallback: T)`, `setSetting(db, key, value)` and so on). Add each function in the task that first needs it. This task adds only `listCategories`, `getSetting` and `setSetting`.

- [ ] **Step 1: Write the failing tests:**
  - `openDb(':memory:')` creates the tables `accounts, bank_profiles, categories, transactions, rules, import_batches, holdings, holding_contributions, holding_valuations, settings, migrations`.
  - Running migrations twice is a no-op (open the same temp file twice and expect `SELECT count(*) FROM migrations` to be 1).
  - The seeded categories match the spec exactly: expense = Groceries, Rent/Housing, Utilities, Transport, Subscriptions, Eating Out, Shopping, Health, Leisure, Travel, Fees, Other; income = Salary, Other Income; transfer = Transfer, Investing.
  - `getSetting(db, 'transferPatterns', [])` returns `['TRF','TRANSF','MB WAY','MBWAY','SEPA','TRANSFERENCIA']`, and `getSetting(db,'aiEnabled',false)` returns `true`.
- [ ] **Step 2: Run** `npm test -w server -- src/db/db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `001_init.sql`: the tables from spec §6 in snake_case, `amount_cents INTEGER`, a unique index on `rules.merchant_key`, an index on `transactions(account_id, date)` and on `transactions(dedupe_hash)`, `categories.name UNIQUE`, `settings(key TEXT PRIMARY KEY, value TEXT /* JSON */)`, plus the seed inserts. Then `openDb` and the three repo functions.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): sqlite schema, migrations and seed data`

---

### Task 3: CSV decoding and parsing with a bank profile

**Files:**
- Create: `server/src/money.ts`, `server/src/import/csv.ts`
- Test: `server/src/money.test.ts`, `server/src/import/csv.test.ts`

**Interfaces:**
- Produces: `parseAmountToCents(raw: string, decimalSeparator: ',' | '.'): number | null`
- Produces: `parseDate(raw: string, format: BankProfile['dateFormat']): string | null` (returns ISO, or null for an invalid date such as 31/02)
- Produces: `decodeCsvBytes(bytes: Uint8Array): string`
- Produces: `parseCsv(text: string, profile: Omit<BankProfile,'id'|'name'>): { rows: ParsedRow[]; errors: RowError[] }` with `ParsedRow = { line: number; date: string; description: string; amountCents: number }` and `RowError = { line: number; raw: string; reason: string }` (both go in shared types)
- Produces: `previewColumns(text: string, delimiter, skipRows: number, n = 5): string[][]` (raw cells for the column-mapping UI)

- [ ] **Step 1: Write the failing tests** (`money.test.ts`), using `it.each` with the decimal separator `','`:

| input | cents |
|---|---|
| `12,30` | 1230 |
| `-12,30` | -1230 |
| `12,30-` | -1230 |
| `(12,30)` | -1230 |
| `1.234,56` | 123456 |
| `€ 12,30` | 1230 |
| `12,30 EUR` | 1230 |
| `''` | null |
| `abc` | null |

  Also with `'.'`: `1,234.56` → 123456. `parseDate('02/11/2026','DD/MM/YYYY')` → `'2026-11-02'`, and `parseDate('31/02/2026','DD/MM/YYYY')` → null.
- [ ] **Step 2: Write the failing tests** (`csv.test.ts`). Fixture `server/test/fixtures/sample-pt.csv`: `;` delimiter, 2 preamble lines, a header, 6 transactions (one `TRANSFERÊNCIA MB WAY`, one debit/credit pair), a blank line and a footer `Saldo final;;;1.234,56`. Tests:
  - Single-amount profile: 6 rows and exactly 1 error (the footer, `reason` matching `/date/i`); the blank line is skipped silently.
  - Debit/credit profile: a debit cell `12,30` → -1230, a credit cell `500,00` → 50000, both empty → error `/amount/i`.
  - `invertSign: true` flips every amount.
  - `descriptionCols: [1,2]` joins the cells with a single space and trims.
  - `decodeCsvBytes` with the Windows-1252 bytes for `TRANSFERÊNCIA` (0xCA for Ê) returns `'TRANSFERÊNCIA'`, a UTF-8 input with a BOM returns its text without the BOM, and a plain UTF-8 `Ê` stays intact.
- [ ] **Step 3: Run** `npm test -w server -- src/money.test.ts src/import/csv.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** `decodeCsvBytes`: `new TextDecoder('utf-8', { fatal: true })`, falling back to `new TextDecoder('windows-1252')` when it throws, then strip a leading `﻿`. `parseCsv`: papaparse with the profile delimiter and `skipEmptyLines: 'greedy'`, then drop `skipRows` lines and the header row if `hasHeader`. Each row that fails date or amount parsing goes to `errors`, and `line` is 1-based in the original file.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(server): bank CSV decoding and profile-driven parsing`

---

### Task 4: Merchant key, scrubber, transfer detection

**Files:**
- Create: `server/src/categorize/text.ts`
- Test: `server/src/categorize/text.test.ts`

**Interfaces:**
- Produces: `stripDiacritics(s: string): string`
- Produces: `merchantKey(description: string): string`
- Produces: `scrubForAi(description: string): string`
- Produces: `isTransferLike(description: string, patterns: string[]): boolean`

- [ ] **Step 1: Write the failing tests:**
  - `merchantKey`:

| input | output |
|---|---|
| `COMPRA 1234 CONTINENTE LISBOA 02/11` | `CONTINENTE LISBOA` |
| `Compra 1234 Continente Lisboa 15/11` | `CONTINENTE LISBOA` |
| `NETFLIX.COM 13/11 *4321` | `NETFLIX.COM` |
| `POS LIDL & CIA 0042` | `LIDL & CIA` |
| `PAG SERV EDP COMERCIAL REF 123456789` | `EDP COMERCIAL` |
| `UBER   *TRIP` | `UBER TRIP` |
| `Café Central 12:45` | `CAFE CENTRAL` |

  - `scrubForAi`: each output contains no `\d{4,}`, no `@`, no `PT50`. Cases: `TRF PT50000201231234567890154 RENDA` → `TRF RENDA`, `PAG 912345678 VODAFONE` → `PAG VODAFONE`, `+351 912 345 678 LOJA` → `LOJA`, `joao@mail.pt PAYPAL` → `PAYPAL`, `CARD XXXX XXXX 1234 AMAZON` → `CARD AMAZON`. A property test: for 200 random strings built from digits, letters and spaces, `/\d{4,}/` never matches the output.
  - `isTransferLike('Transferência MB WAY p/ Maria', defaults)` → true, `isTransferLike('SEPA DD EDP', defaults)` → true, `isTransferLike('TRFX COFFEE', defaults)` → false (patterns match whole words), `isTransferLike('CONTINENTE', defaults)` → false.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `merchantKey`: strip diacritics, uppercase, then remove dates (`\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?`), times, `REF\s*\d+`, card masks (`\*\d+`, `X{4}`), digit runs of 3 or more and lone `*`, then strip leading prefixes `COMPRA|PAG(AMENTO)?( SERV)?|POS|DD|TPA` and collapse whitespace. `scrubForAi`: remove IBAN (`[A-Z]{2}\d{2}[A-Z0-9]{10,30}`), emails, phone-like sequences (`\+?\d[\d ]{7,}\d`), card masks and any `\d{4,}`, then collapse whitespace. It does not uppercase. `isTransferLike`: diacritic-stripped, uppercased, word-boundary match for each pattern.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): merchant normalization, AI scrubber, transfer detection`

---

### Task 5: Duplicate detection and manual-entry matching

**Files:**
- Create: `server/src/import/dedupe.ts`
- Test: `server/src/import/dedupe.test.ts`

**Interfaces:**
- Consumes: `ParsedRow` (Task 3)
- Produces: `descriptionHash(accountId: number, date: string, amountCents: number, description: string): string` (sha1 hex of `accountId|date|amountCents|normalizedDescription`, where the description is uppercased, diacritic-stripped and whitespace-collapsed)
- Produces: `markDuplicates(hashes: string[], existingCounts: Map<string, number>): boolean[]` (true = duplicate)
- Produces: `matchManualEntries(rows: {date: string; amountCents: number}[], manual: {id: number; date: string; amountCents: number}[]): (number | null)[]` (the matched manual id per row)

- [ ] **Step 1: Write the failing tests:**
  - `markDuplicates(['a','a','a','b'], new Map([['a',2]]))` → `[true,true,false,false]`.
  - `matchManualEntries`: a row on 2026-11-05 for -1230 and a manual entry on 2026-11-03 for -1230 → matched. A manual entry on 2026-11-01 (4 days earlier) → null. A different amount → null. Two rows and one manual entry → only the row with the closest date matches, and on a tie the earliest row wins. One row and two manual entries → the closest manual entry, and each manual entry is used at most once.
  - `descriptionHash` is equal for `'Continente  Lisboa'` and `'CONTINENTE LISBOA'`, and differs when the account differs.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** For matching, sort all candidate (row, manual) pairs with |Δdays| ≤ 3 by (Δdays, row index) and assign greedily. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): count-aware dedupe and manual-entry matching`

---

### Task 6: Categorizer (rules → transfer guard → AI)

**Files:**
- Create: `server/src/categorize/ai.ts`, `server/src/categorize/categorizer.ts`
- Test: `server/src/categorize/ai.test.ts`, `server/src/categorize/categorizer.test.ts`

**Interfaces:**
- Consumes: `merchantKey`, `scrubForAi`, `isTransferLike` (Task 4)
- Produces:

```ts
interface AiItem { id: string; description: string; amount: number /* euros */ }
interface AiCategorizer { categorize(items: AiItem[], categoryNames: string[]): Promise<Map<string, string | null>> }
function createClaudeCategorizer(client: Anthropic, log?: (payload: unknown) => void): AiCategorizer
interface CategorizeInput { key: string /* row id */; description: string; amountCents: number }
interface CategorizeResult { categoryId: number | null; source: CategorySource }
function categorizeRows(rows: CategorizeInput[], deps: {
  rules: Map<string, number>; transferPatterns: string[]; categories: Category[];
  ai: AiCategorizer | null; aiEnabled: boolean;
}): Promise<{ results: Map<string, CategorizeResult>; aiNotice: string | null }>
```

- [ ] **Step 1: Write the failing tests** (`categorizer.test.ts`, with a fake `AiCategorizer` that records its calls):
  - A row whose merchantKey has a rule gets `{categoryId: rule, source:'rule'}`, and the AI receives no item for it.
  - A transfer-like row gets `{null,'none'}` and is never sent to the AI.
  - The AI is called once per **unique** merchantKey (two NETFLIX rows → one item). Every row with that key gets the answer, with `source:'ai'`.
  - Every AI item's description equals `scrubForAi(original)`, `amount` is in euros (`-1399` → `-13.99`), and the item has exactly the keys `id, description, amount`.
  - Items are batched at most 50 per call (120 unique keys → 3 calls).
  - The AI returns an off-list name, `null`, or an id that wasn't sent → those rows get `{null,'none'}`, and the unknown id is ignored.
  - The AI throws → every non-rule row is `{null,'none'}` and `aiNotice` matches `/AI categorization failed/`. With `ai === null` or `aiEnabled === false`, `aiNotice` matches `/AI is off/`.
- [ ] **Step 2: Write the failing tests** (`ai.test.ts`, with a stubbed `client.messages.parse`):
  - The request has `model: 'claude-haiku-5-5'` and `output_config.effort: 'low'`. The user content is a JSON array of the items, and the system prompt lists the category names and the `unknown` option.
  - `stop_reason: 'refusal'` or `parsed_output: null` → every id maps to null.
  - An answer of `'unknown'` → null.
- [ ] **Step 3: Run** both test files. Expected: FAIL.
- [ ] **Step 4: Implement** `createClaudeCategorizer` with `client.messages.parse({ model: 'claude-haiku-5-5', max_tokens: 4000, system, messages:[{role:'user', content: JSON.stringify(items)}], output_config: { effort: 'low', format: zodOutputFormat(z.object({ results: z.array(z.object({ id: z.string(), category: z.enum([...categoryNames, 'unknown']) })) })) } })` (imports: `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`). Check `stop_reason` before reading `parsed_output`. Call `log(items)` before sending (index.ts wires this to `console.debug` only when `LOG_AI_PAYLOAD=1`). Then implement `categorizeRows` per the tests.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(server): rule-first categorizer with scrubbed, batched Claude fallback`

---

### Task 7: Setup API (accounts, bank profiles, categories, rules, settings, backup)

**Files:**
- Create: `server/src/routes/setup.ts`, `server/src/routes/admin.ts`
- Modify: `server/src/app.ts`, `server/src/db/repo.ts`
- Test: `server/src/routes/setup.test.ts`

**Interfaces** (all JSON bodies use the shared types without `id`):
- `GET/POST /api/accounts`, `PUT /api/accounts/:id`
- `GET/POST /api/bank-profiles`, `PUT/DELETE /api/bank-profiles/:id` (deleting sets `accounts.bank_profile_id` to null)
- `GET/POST /api/categories`, `PUT /api/categories/:id` (rename and kind only; no delete in v1)
- `GET /api/rules`, `DELETE /api/rules/:id`, `GET /api/rules/suggest?description=…` → `{ categoryId: number | null }`
- `GET/PUT /api/settings` → `{ transferPatterns: string[]; aiEnabled: boolean; aiConfigured: boolean }` (`aiConfigured` = the key is present; the key itself is never returned)
- `POST /api/backup` → `{ file: string }` (`db.backup('data/backups/finance-YYYYMMDD-HHmmss.db')`)
- Validation: zod schemas in each router. An invalid body returns 400 `{ error: string }`.

- [ ] **Step 1: Write the failing tests** (supertest, in-memory DB):
  - Account CRUD round-trip, and a POST with a missing name returns 400.
  - A profile with `amountMode:'single'` and `amountCol:null` returns 400.
  - Deleting a profile nulls the account's `bankProfileId`.
  - `GET /api/rules/suggest?description=COMPRA 99 CONTINENTE LISBOA 01/12` returns the rule category after inserting a rule for `CONTINENTE LISBOA`.
  - `GET /api/settings` never contains the API key value, even when `ANTHROPIC_API_KEY='sk-test'` is set: serialize the body and assert it doesn't contain `sk-test`.
  - `POST /api/backup` against a temp file DB creates the file.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** the routers and repo functions. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): setup and settings API`

---

### Task 8: Import API (preview + commit)

**Files:**
- Create: `server/src/routes/import.ts`
- Modify: `server/src/app.ts`, `server/src/db/repo.ts`, `shared/src/types.ts`
- Test: `server/src/routes/import.test.ts`

**Interfaces:**
- `POST /api/import/columns` `{ fileBase64, delimiter, skipRows }` → `{ cells: string[][] }` (wraps `previewColumns`)
- `POST /api/import/preview` `{ accountId, profile: BankProfile | Omit<BankProfile,'id'>, fileBase64 }` → `ImportPreview`:

```ts
interface PreviewRow { key: string; line: number; date: string; description: string; amountCents: number;
  status: 'new' | 'duplicate' | 'possible_manual_match';
  categoryId: number | null; categorySource: CategorySource;   // for duplicates: the stored category
  matchedManual: Transaction | null }
interface ImportPreview { rows: PreviewRow[]; errors: RowError[]; aiNotice: string | null }
```

- `POST /api/import/commit` `{ accountId, fileName, rows: CommitRow[] }` where `CommitRow = { key, date, description, amountCents, categoryId, categorySource, action: 'save' | 'skip' | 'replace' | 'keep_both', replaceTransactionId?: number }` → `{ batchId, saved: number, skipped: number }`
- Preview does no DB writes. Commit runs in a single `db.transaction`: it inserts the `save`/`keep_both` rows and the `replace` rows (deleting their manual entry), upserts a rule for every row with `categorySource === 'manual' && categoryId !== null`, and records an `import_batches` row.
- `new` and `possible_manual_match` rows are categorized via `categorizeRows`. Duplicates are not (they show their stored category). Default actions the client will use: `new` → save, `duplicate` → skip, `possible_manual_match` → skip.

- [ ] **Step 1: Write the failing tests:**
  - A preview of the fixture CSV returns 6 rows and 1 error, and `SELECT count(*) FROM transactions` is unchanged.
  - Committing then re-previewing the same file → all rows are `duplicate`, with the categories saved by the first commit.
  - A file containing the same coffee row twice, against a DB that has it once → one `duplicate` and one `new`.
  - A manual entry on the account for -1230 dated 2 days before a CSV row → that row is `possible_manual_match` with `matchedManual.id` set. Committing it with `replace` deletes the manual entry and inserts the bank row.
  - Committing a row with `categorySource:'manual'` creates a rule for its merchantKey. Existing transactions with the same merchantKey keep their category.
  - The AI fake is never called for duplicates or transfer-like rows.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): import preview and transactional commit`

---

### Task 9: Transactions API (list, manual add/edit/delete, correction, export)

**Files:**
- Create: `server/src/routes/transactions.ts`, `server/src/export/excelCsv.ts`
- Modify: `server/src/app.ts`, `server/src/db/repo.ts`
- Test: `server/src/routes/transactions.test.ts`, `server/src/export/excelCsv.test.ts`

**Interfaces:**
- `GET /api/transactions?accountId&categoryId&month&q&uncategorized=1` → `Transaction[]` (newest first; `categoryId=none` filters for null)
- `POST /api/transactions` `{ accountId, date, description, amountCents, categoryId }` → `Transaction` with `origin:'manual'`, `categorySource` = `'rule'` if `categoryId` equals the rule suggestion for its merchantKey, else `'manual'`. A manual source with a category upserts the rule. It never calls the AI.
- `PATCH /api/transactions/:id` with any of `{ date, description, amountCents, categoryId }`. A changed `categoryId` sets `categorySource:'manual'` and upserts the rule for this row's merchantKey, and no other transaction changes. Changing `description` recomputes `merchantKey` and `dedupeHash`.
- `DELETE /api/transactions/:id` → 204
- `GET /api/export/transactions.csv?<same filters>` → `text/csv` attachment
- `GET /api/export/holdings.csv` → added in Task 11
- `toExcelCsv(header: string[], rows: (string | number)[][]): string`: starts with `﻿`, uses `;` as the delimiter, `\r\n` line endings, numbers formatted with a decimal comma and 2 decimals, and fields containing `;`, `"` or a newline quoted with `"` (inner quotes doubled).

- [ ] **Step 1: Write the failing tests:**
  - `toExcelCsv(['a','b'], [['x;y', -12.3]])` → `'﻿a;b\r\n"x;y";-12,30\r\n'`.
  - POST a manual transaction → its `origin` is `'manual'`, the AI fake is never called, and a rule now exists.
  - PATCH the category of one of two CONTINENTE rows → only that row changes, and the rule is updated.
  - `GET ?categoryId=none` returns only uncategorized rows.
  - The export header is `Date;Account;Description;Amount;Category`, a row's amount is `-54,20`, and the filters are respected.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): transactions CRUD, manual entry, corrections, CSV export`

---

### Task 10: Spending report

**Files:**
- Create: `server/src/reports/spending.ts`, `server/src/routes/reports.ts`
- Modify: `server/src/app.ts`, `shared/src/types.ts`
- Test: `server/src/reports/spending.test.ts`

**Interfaces:**
- Produces: `spendingSummary(txs: Transaction[], categories: Category[], month: string): SpendingSummary`

```ts
interface SpendingSummary {
  month: string;
  byCategory: { categoryId: number | null; name: string; cents: number; prevCents: number }[]; // expenses, positive cents, sorted desc
  totalExpenseCents: number; totalIncomeCents: number; investedCents: number; uncategorizedCount: number;
  topMerchants: { merchantKey: string; cents: number; count: number }[];                    // top 10 expense merchants
  last12: { month: string; incomeCents: number; expenseCents: number; netCents: number }[]; // oldest→newest, ending at `month`
}
```

- `GET /api/reports/spending?month=YYYY-MM&accountId=` (if `month` is missing, use the latest month with data, or the current month if there is none)
- Rules: expense = an amount < 0 whose category is null or of kind `expense`. Income = an amount > 0 whose category is null or of kind `income`. Kind `transfer` is excluded from both. `investedCents` = −sum of amounts in the category named `Investing`. Uncategorized expenses appear in `byCategory` as `{categoryId:null, name:'Uncategorized'}`.

- [ ] **Step 1: Write the failing tests:**
  - Groceries -5000 in 2026-11 and -3000 in 2026-10 → that row is `{cents:5000, prevCents:3000}`.
  - A transfer-kind row of -20000 does not change the totals. An `Investing` row of -10000 → `investedCents` is 10000.
  - A refund (+500 in Shopping) reduces the Shopping expense: `cents` is the net of the category's amounts, floored at 0.
  - `last12` has exactly 12 entries ending at the selected month, with zeros for empty months (Review Focus 5), and crosses the year boundary correctly (2026-02 → it starts at 2025-03).
  - `topMerchants` groups by merchantKey, has at most 10 entries and excludes income.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): monthly spending report`

---

### Task 11: Investments (estimate model + holdings API)

**Files:**
- Create: `server/src/reports/investments.ts`, `server/src/routes/holdings.ts`
- Modify: `server/src/app.ts`, `server/src/routes/transactions.ts` (holdings export), `shared/src/types.ts`
- Test: `server/src/reports/investments.test.ts`, `server/src/routes/holdings.test.ts`

**Interfaces:**
- Produces: `estimateHoldingSeries(h: Holding, contributions: HoldingContribution[], valuations: HoldingValuation[], untilMonth: string): HoldingPoint[]` with `HoldingPoint = { month: string; contributedCents: number /* cumulative */; valueCents: number; confirmed: boolean }`
- The algorithm is fixed by the spec. For each month from `startDate`'s month to `untilMonth`:
  1. Add this month's contribution: the latest `monthly` row with `effectiveFrom` ≤ the last day of the month (0 if there is none), plus every `one_off` row dated in this month.
  2. Then `value *= (1 + r) ** (1/12)`.
  3. If valuations exist in this month, set `value` to the latest one and mark `confirmed: true`.
  4. Round `valueCents` with `Math.round` when emitting, but keep full precision internally.
- Routes: `GET/POST /api/holdings`, `PUT/DELETE /api/holdings/:id`, `POST /api/holdings/:id/contributions`, `DELETE /api/holding-contributions/:id`, `POST /api/holdings/:id/valuations`, `DELETE /api/holding-valuations/:id`, and `GET /api/reports/investments?until=YYYY-MM` → `{ holdings: { holding: Holding; series: HoldingPoint[]; latest: HoldingPoint; gainCents: number; gainPct: number }[] }`.
- `GET /api/export/holdings.csv` columns: `Holding;Contributed;Value;Value date;Status` (Status = `Confirmed` or `Estimated`).

- [ ] **Step 1: Write the failing tests:**
  - €100/month at 12%, start 2026-01-01, until 2026-02 → values `10095` and `20286` cents, contributed `10000` and `20000`.
  - The same setup with a valuation of `15000` dated 2026-01-20 → January is `15000` and confirmed. February: `Math.round((15000+10000)*1.12**(1/12))` = `25237`, not confirmed.
  - The monthly amount changes to €200 from 2026-02-01 → February adds 20000.
  - A one-off of €1000 on 2026-02-10 → it is added in February only.
  - A start date mid-month (2026-01-15) still contributes in January.
  - `untilMonth` before the start month → `[]`.
  - Route test: create a holding, contribution and valuation, then the report returns `latest.confirmed`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): manual-monthly investment model and holdings API`

---

### Task 12: Net worth

**Files:**
- Create: `server/src/reports/netWorth.ts`
- Modify: `server/src/routes/reports.ts`
- Test: `server/src/reports/netWorth.test.ts`

**Interfaces:**
- Produces: `netWorthSeries(accounts: Account[], txs: Transaction[], holdingSeries: HoldingPoint[][], untilMonth: string): { month: string; bankCents: number; investmentsCents: number; totalCents: number }[]`
- It starts at the earliest `openingBalanceDate` month across accounts. A month-end balance per account = `openingBalanceCents` + the sum of its transactions dated on or after `openingBalanceDate` and on or before that month's end. An account contributes 0 before its opening month. Each holding contributes its point's `valueCents` for that month, or 0 before its start.
- `GET /api/reports/net-worth?until=YYYY-MM`

- [ ] **Step 1: Write the failing tests:**
  - One account opening at €1000 on 2026-01-01, -€100 in January, nothing in February → Jan 90000, Feb 90000 (the gap is carried forward).
  - A transaction dated before `openingBalanceDate` is ignored.
  - A second account opening in March contributes 0 in January and February.
  - Holdings are added per month. With no accounts → `[]`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): net worth series`

---

### Task 13: Client foundation (routing, API client, formatting, Settings page)

**Files:**
- Create: `client/src/api.ts`, `client/src/format.ts`, `client/src/App.tsx`, `client/src/pages/Settings.tsx`, `client/src/components/CategorySelect.tsx`
- Modify: `client/src/main.tsx`, `client/package.json` (vitest + jsdom + @testing-library/react)
- Test: `client/src/format.test.ts`, `client/src/pages/Settings.test.tsx`

**Interfaces:**
- Produces: `api` (typed fetch wrappers over every route in Tasks 7–12). It throws `ApiError(status, message)` on a non-2xx response.
- Produces: `formatEuros(cents: number): string` using `Intl.NumberFormat('pt-PT', { style:'currency', currency:'EUR' })`, and `parseEurosToCents(input: string): number | null` (accepts `12,30` and `12.30`).
- Produces: `<CategorySelect value onChange categories allowNone />`, grouped by kind.
- Routes: `/` (Spending), `/transactions`, `/import`, `/investments`, `/net-worth`, `/settings`, with a left nav.
- Settings page sections (spec §13): accounts (name, opening balance and date), bank profiles (list, rename, delete), categories (add, rename, change kind), rules (list with delete), transfer patterns (editable list), an AI toggle with a status line ("API key configured" / "No API key — add it to .env"), and a Backup button that shows the created file path.

- [ ] **Step 1: Write the failing tests:**
  - `formatEuros(-123456)` contains `1234,56` (normalize the non-breaking spaces before comparing), `parseEurosToCents('12,30')` → 1230 and `parseEurosToCents('x')` → null.
  - Settings with a mocked `api`: with `aiConfigured:false` the text "No API key" is shown, and adding an account calls `api.createAccount` with `openingBalanceCents` in cents.
- [ ] **Step 2: Run** `npm test -w client`. Expected: FAIL. **Step 3: Implement** (react-query `QueryClientProvider` in `main.tsx`; plain CSS with light/dark via `prefers-color-scheme`). **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): app shell, API client, settings page`

---

### Task 14: Client import wizard

**Files:**
- Create: `client/src/pages/Import.tsx`, `client/src/components/ColumnMapper.tsx`, `client/src/components/ImportPreview.tsx`
- Test: `client/src/components/ImportPreview.test.tsx`, `client/src/components/ColumnMapper.test.tsx`

**Interfaces:**
- Consumes: `api.importColumns`, `api.importPreview`, `api.importCommit`, `api.createBankProfile`
- The flow, matching spec §7:
  1. Pick the account and file. The file is read as an ArrayBuffer and base64-encoded.
  2. If the account has no profile, or "Change mapping" is clicked: show `ColumnMapper` with the raw cells table, a dropdown per role, the date format, decimal separator, delimiter, skip rows, header toggle and invert sign. A live sample (calling preview with an unsaved profile) shows the first 5 parsed rows. Saving creates the profile and links it to the account.
  3. `ImportPreview` table: date, description, amount and a `CategorySelect`, plus a source badge (`rule`/`AI`/`—`) and a status. A separate "Rows not imported" list shows the errors. An `aiNotice` banner appears when there is one.
  4. A Save button shows "Save N transactions" and calls commit, then links to Transactions.
- `ImportPreview` props: `{ preview: ImportPreview; categories: Category[]; onCommit(rows: CommitRow[]): void }`. Its local state holds each row's category and action.

- [ ] **Step 1: Write the failing tests** (`ImportPreview`):
  - A duplicate row renders its stored category, its select is disabled, it's labelled "duplicate", and it's excluded from N.
  - A `possible_manual_match` row shows the manual entry's description and date and offers the actions skip/replace/keep both (default skip). Choosing replace sends `action:'replace', replaceTransactionId`.
  - Changing a new row's category sends that row with `categorySource:'manual'`, and other rows keep their source.
  - The Save label counts only rows with `save`, `replace` or `keep_both`.
- [ ] **Step 2: Write the failing test** (`ColumnMapper`): choosing the debit/credit mode hides the amount column dropdown and requires both debit and credit, so Save is disabled until both are set.
- [ ] **Step 3: Run.** Expected: FAIL. **Step 4: Implement.** **Step 5: Run.** Expected: PASS. Then try it manually: import `server/test/fixtures/sample-pt.csv` end to end in `npm run dev`.
- [ ] **Step 6: Commit** `feat(client): CSV import wizard with column mapping and preview`

---

### Task 15: Client transactions page and manual entry

**Files:**
- Create: `client/src/pages/Transactions.tsx`, `client/src/components/AddTransactionForm.tsx`
- Test: `client/src/components/AddTransactionForm.test.tsx`

**Interfaces:**
- Consumes: `api.listTransactions`, `api.createTransaction`, `api.updateTransaction`, `api.deleteTransaction`, `api.suggestCategory`, and an export URL builder.
- Transactions page: filters (account, category including "Uncategorized", month, a search box), a table with inline `CategorySelect` (PATCH on change), an edit button opening the form in edit mode, delete with `window.confirm`, an "Export CSV" link carrying the current filters, and an "Add transaction" button.
- `AddTransactionForm` props: `{ accounts; categories; initial?: Transaction; onSaved(): void }`. Fields: account, date (default today), description, amount (positive input) plus an expense/income toggle (expense by default, which negates the amount), and category. The description is debounced by 300 ms before calling `api.suggestCategory`, which pre-selects the category only if the user hasn't picked one.

- [ ] **Step 1: Write the failing tests:**
  - Typing "Continente" with a suggest mock returning id 3 → the select shows category 3. If the user picked a category before the suggestion arrives, their pick is kept.
  - Submitting €12,30 as an expense → `createTransaction` is called with `amountCents: -1230`. As income → `1230`.
  - An empty description or an invalid amount → the submit is disabled and no API call happens.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): transactions page with manual entry, edit, delete, export`

---

### Task 16: Client spending dashboard

Load the `dataviz` skill before writing the chart code.

**Files:**
- Create: `client/src/pages/Spending.tsx`
- Test: `client/src/pages/Spending.test.tsx`

**Interfaces:**
- Consumes: `api.spendingReport(month, accountId)` → `SpendingSummary`
- Layout (spec §9):
  - month picker and account filter;
  - stat tiles (expenses, income, net, invested this month, and an uncategorized count linking to `/transactions?categoryId=none&month=…`);
  - a horizontal bar chart of expenses by category with the previous-month delta (▲/▼ %) next to each bar;
  - a 12-month grouped bar chart of income vs expenses with a net line;
  - a top merchants table.

- [ ] **Step 1: Write the failing test:** with a mocked report, the tiles show `formatEuros` values. A category with `prevCents: 0` shows "new" instead of a percentage (no division by zero). `uncategorizedCount: 0` hides the link.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** with Recharts. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): spending dashboard`

---

### Task 17: Client investments and net worth pages

Load the `dataviz` skill before writing the chart code.

**Files:**
- Create: `client/src/pages/Investments.tsx`, `client/src/pages/NetWorth.tsx`
- Test: `client/src/pages/Investments.test.tsx`

**Interfaces:**
- Consumes: `api.investmentsReport`, the holdings CRUD calls, `api.netWorth`
- Investments page (spec §10):
  - a card per holding: put in, value, the label `estimated` or `confirmed on <date>`, and gain € and %;
  - an "Update value" dialog (date and value) that posts a valuation;
  - a manage dialog (name, type, start date, expected return %, contribution schedule rows, one-offs);
  - a line chart of value vs contributed, where estimated segments are dashed and confirmed points have dot markers;
  - an allocation donut by holding and by type;
  - an "Export CSV" link to `/api/export/holdings.csv`.
- Net worth page: a stacked area chart (bank accounts vs investments) over time, plus the current total.

- [ ] **Step 1: Write the failing tests:** a holding whose `latest.confirmed` is false shows "estimated". Submitting the update-value dialog calls `api.addValuation(id, { date, valueCents })` with cents. Entering an expected return of `2,5` saves `0.025`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): investments and net worth dashboards`

---

### Task 18: Production start and end-to-end check

**Files:**
- Modify: `server/src/index.ts` (pass `clientDistDir: path.resolve(__dirname,'../../client/dist')` when it exists), `README.md` (create: setup, `.env`, `start.bat`, where the data lives, backups, privacy notes)
- Test: `server/src/app.test.ts` (add one case)

- [ ] **Step 1: Write the failing test:** `createApp({ ..., clientDistDir: tmpDirWithIndexHtml })` → `GET /investments` returns that `index.html`, and `GET /api/health` is still JSON.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`. Expected: every workspace passes.
- [ ] **Step 5: Manual check:** run `start.bat`, then the browser opens `http://127.0.0.1:4321`. Create an account, import the fixture CSV, correct one category, add a manual transaction, add the three holdings (2× Certificados de Aforro, 1× Trading 212 ETFs), then view all dashboards and export both CSVs. Open the exported CSV in Excel and check the accents and decimal commas. With `LOG_AI_PAYLOAD=1`, confirm the logged payload has no IBANs, digit runs of 4 or more, or names from transfer rows.
- [ ] **Step 6: Commit** `feat: production start script and README`
