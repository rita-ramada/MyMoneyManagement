export type CategoryKind = 'expense' | 'income' | 'transfer';
export type CategorySource = 'rule' | 'ai' | 'manual' | 'none';

export interface Category { id: number; name: string; kind: CategoryKind }

export interface Account {
  id: number;
  name: string;
  bankProfileId: number | null;
  openingBalanceCents: number;
  openingBalanceDate: string;
}

export interface BankProfile {
  id: number;
  name: string;
  delimiter: ',' | ';' | '\t';
  skipRows: number;
  hasHeader: boolean;
  dateCol: number;
  descriptionCols: number[];
  amountMode: 'single' | 'debitCredit';
  amountCol: number | null;
  debitCol: number | null;
  creditCol: number | null;
  dateFormat: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
  decimalSeparator: ',' | '.';
  invertSign: boolean;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  description: string;
  merchantKey: string;
  amountCents: number;
  categoryId: number | null;
  categorySource: CategorySource;
  origin: 'import' | 'manual';
  importBatchId: number | null;
  dedupeHash: string;
}

export interface Rule { id: number; merchantKey: string; categoryId: number; createdAt: string }

export interface Holding {
  id: number;
  name: string;
  type: 'savings_certificate' | 'etf' | 'stock' | 'crypto' | 'savings';
  startDate: string;
  /** 0.025 = 2.5% */
  expectedAnnualReturn: number;
}

export interface HoldingContribution {
  id: number;
  holdingId: number;
  kind: 'monthly' | 'one_off';
  amountCents: number;
  effectiveFrom: string;
}

export interface HoldingValuation { id: number; holdingId: number; date: string; valueCents: number }
