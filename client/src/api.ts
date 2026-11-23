import type {
  Account, BankProfile, Category, CommitRow, Holding, HoldingContribution, HoldingPoint, HoldingValuation,
  ImportPreview, Rule, SpendingSummary, Transaction,
} from '@mmm/shared/src/types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = ((await res.json()) as { error?: string }).error ?? message; } catch { /* non-JSON */ }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type AccountInput = Omit<Account, 'id'>;
export type ProfileInput = Omit<BankProfile, 'id'>;
export interface Settings { transferPatterns: string[]; aiEnabled: boolean; aiConfigured: boolean }
export interface TransactionFilter {
  accountId?: number; categoryId?: number | 'none'; month?: string; q?: string;
}
export interface TransactionInput {
  accountId: number; date: string; description: string; amountCents: number; categoryId: number | null;
}
export type HoldingInput = Omit<Holding, 'id'>;
export interface HoldingReportRow {
  holding: Holding; series: HoldingPoint[]; latest: HoldingPoint | null; gainCents: number; gainPct: number;
}
export interface NetWorthPoint { month: string; bankCents: number; investmentsCents: number; totalCents: number }

const txQuery = (f: TransactionFilter) => qs({ accountId: f.accountId, categoryId: f.categoryId, month: f.month, q: f.q });

export const api = {
  listAccounts: () => call<Account[]>('GET', '/accounts'),
  createAccount: (a: AccountInput) => call<Account>('POST', '/accounts', a),
  updateAccount: (id: number, a: AccountInput) => call<Account>('PUT', `/accounts/${id}`, a),

  listBankProfiles: () => call<BankProfile[]>('GET', '/bank-profiles'),
  createBankProfile: (p: ProfileInput) => call<BankProfile>('POST', '/bank-profiles', p),
  updateBankProfile: (id: number, p: ProfileInput) => call<BankProfile>('PUT', `/bank-profiles/${id}`, p),
  deleteBankProfile: (id: number) => call<void>('DELETE', `/bank-profiles/${id}`),

  listCategories: () => call<Category[]>('GET', '/categories'),
  createCategory: (c: Omit<Category, 'id'>) => call<Category>('POST', '/categories', c),
  updateCategory: (id: number, c: Omit<Category, 'id'>) => call<Category>('PUT', `/categories/${id}`, c),

  listRules: () => call<Rule[]>('GET', '/rules'),
  deleteRule: (id: number) => call<void>('DELETE', `/rules/${id}`),
  suggestCategory: (description: string) =>
    call<{ categoryId: number | null }>('GET', `/rules/suggest${qs({ description })}`),

  getSettings: () => call<Settings>('GET', '/settings'),
  updateSettings: (s: Partial<Pick<Settings, 'transferPatterns' | 'aiEnabled'>>) => call<Settings>('PUT', '/settings', s),
  backup: () => call<{ file: string }>('POST', '/backup'),

  importColumns: (b: { fileBase64: string; delimiter: string; skipRows: number }) =>
    call<{ cells: string[][] }>('POST', '/import/columns', b),
  importPreview: (b: { accountId: number; profile: ProfileInput; fileBase64: string }) =>
    call<ImportPreview>('POST', '/import/preview', b),
  importCommit: (b: { accountId: number; fileName: string; rows: CommitRow[] }) =>
    call<{ batchId: number; saved: number; skipped: number }>('POST', '/import/commit', b),

  listTransactions: (f: TransactionFilter = {}) => call<Transaction[]>('GET', `/transactions${txQuery(f)}`),
  createTransaction: (t: TransactionInput) => call<Transaction>('POST', '/transactions', t),
  updateTransaction: (id: number, p: Partial<Omit<TransactionInput, 'accountId'>>) =>
    call<Transaction>('PATCH', `/transactions/${id}`, p),
  deleteTransaction: (id: number) => call<void>('DELETE', `/transactions/${id}`),

  spendingReport: (month?: string, accountId?: number) =>
    call<SpendingSummary>('GET', `/reports/spending${qs({ month, accountId })}`),
  netWorth: (until?: string) => call<NetWorthPoint[]>('GET', `/reports/net-worth${qs({ until })}`),
  investmentsReport: (until?: string) =>
    call<{ holdings: HoldingReportRow[] }>('GET', `/reports/investments${qs({ until })}`),

  listHoldings: () => call<Holding[]>('GET', '/holdings'),
  createHolding: (h: HoldingInput) => call<Holding>('POST', '/holdings', h),
  updateHolding: (id: number, h: HoldingInput) => call<Holding>('PUT', `/holdings/${id}`, h),
  deleteHolding: (id: number) => call<void>('DELETE', `/holdings/${id}`),
  addContribution: (holdingId: number, c: Omit<HoldingContribution, 'id' | 'holdingId'>) =>
    call<HoldingContribution>('POST', `/holdings/${holdingId}/contributions`, c),
  deleteContribution: (id: number) => call<void>('DELETE', `/holding-contributions/${id}`),
  addValuation: (holdingId: number, v: Omit<HoldingValuation, 'id' | 'holdingId'>) =>
    call<HoldingValuation>('POST', `/holdings/${holdingId}/valuations`, v),
  deleteValuation: (id: number) => call<void>('DELETE', `/holding-valuations/${id}`),
};

export const exportUrls = {
  transactions: (f: TransactionFilter) => `/api/export/transactions.csv${txQuery(f)}`,
  holdings: () => '/api/export/holdings.csv',
};
