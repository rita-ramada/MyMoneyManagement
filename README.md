# MyMoneyManagement

A personal finance app that runs only on your own computer. You can import bank CSVs (or add transactions by hand), have them sorted into categories, and see where your money goes. It also tracks your savings and investments and your net worth over time.

## First-time setup (Windows)

1. Install **Node.js 22 or newer** (LTS) from nodejs.org.
2. In this folder, run `npm install`.
3. Optional: to have AI suggest categories, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY=...`. Without a key, the app still works. Rows that no rule covers are left as *Uncategorized* for you to pick.

## Starting it

Double-click **`start.bat`**. It builds the interface, starts the local server and opens `http://127.0.0.1:4321` in your browser. Keep the window open while you use the app, and close it to stop.

For development, `npm run dev` runs the server with auto-reload, and the UI runs at `http://localhost:5173`. `npm test` runs all tests.

## First steps in the app

1. **Settings → Accounts**: add each bank account with its balance on a start date.
2. **Import**: choose the account and a CSV file. The first time you import from a bank, you map its columns once, and that bank format is saved. You then check the preview and save it.
3. **Transactions**: fix categories, add cash or other transactions by hand, and export to CSV.
4. **Investments**: add your holdings with a monthly contribution and an expected yearly return. Use *Update value* whenever you know the real value.

## Where your data lives

- Everything is in one file: `data/finance.db`. You can change the location with `DATA_DIR` in `.env`.
- **Settings → Backup** saves a dated copy to `data/backups/`. Copy that folder somewhere safe from time to time.
- `data/` and `.env` are git-ignored.

## Privacy

- The server only accepts connections from this computer (`127.0.0.1`), not from your network.
- The API key stays on the server. It is never sent to the browser or logged.
- The only thing that ever leaves your computer is sent to the AI when it categorizes a merchant it hasn't seen before. That is the **description**, with account numbers, IBANs, card numbers, phone numbers, emails and any group of 4 or more digits removed, plus the **amount**. Dates, account names and balances are never sent.
- Transfers to people (descriptions matching *transfer patterns* such as `TRF` or `MB WAY`) are never sent. You can edit the patterns in Settings.
- Your own corrections are saved as rules and applied first, so the more you use the app, the less it asks the AI.
- To see exactly what is sent, set `LOG_AI_PAYLOAD=1` in `.env` and watch the server window.
