import type { ImportTransactionEntity } from '@actual-app/core/types/models';

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Source = { provider: string; connectionId: string };
export type Currency = { code: string; scale: number };
// Signed integer minor units serialized as text: inflows positive, outflows negative.
export type Money = Currency & { minor: string };
export type AccountDefinition = {
  name: string;
  type: 'bank' | 'credit_card' | 'wallet' | 'loan' | 'investment' | 'other';
  currency: Currency;
};
export type FinancialAccount = AccountDefinition & {
  id: string;
  actualAccountId: string | null;
};
export type Observation = {
  externalId: string;
  accountId: string; // Canonical account ID, resolved before ingestion.
  sourceAccountId: string;
  version: number; // Monotonic source batch sequence, stable across retries.
  observedAt: string;
  date: string; // Calendar date supplied by source; never inferred from server timezone.
  bookedAt?: string;
  amount: Money;
  description: string;
  status: 'pending' | 'posted' | 'removed';
  verification: 'verified' | 'unverified';
  replacesExternalId?: string;
  raw: Json;
};
export type FinancialTransaction = Omit<
  Observation,
  'raw' | 'replacesExternalId'
> & {
  id: string;
  source: Source;
  settlement: 'pending' | 'posted';
};
export type IngestionResult = {
  externalId: string;
  id: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'stale' | 'superseded';
};
export type LedgerProjection = {
  upserts: {
    canonicalId: string;
    actualTransactionId: string | null;
    transaction: ImportTransactionEntity;
  }[];
  deletions: { canonicalId: string; actualTransactionId: string }[];
  excluded: {
    canonicalId: string;
    reason:
      | 'pending'
      | 'unverified'
      | 'unmapped-account'
      | 'currency-mismatch'
      | 'amount-not-representable';
  }[];
};
export type Vault = {
  seal(value: unknown, context: string): string;
  open(value: string, context: string): unknown;
};
