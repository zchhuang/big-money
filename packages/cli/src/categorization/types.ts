export type ReviewTransaction = {
  id: string;
  account: string;
  payee: string | null;
  merchant: string;
  amount: number;
  date: string;
  category: string | null;
  importedId?: string;
  eligible: boolean;
};
export type ReviewCategory = { id: string; name: string; income: boolean };
export type Suggestion = {
  category: string;
  confidence: number;
  explanation: string;
  source: 'correction' | 'local-model';
  model?: string;
  promptVersion?: string;
};
export type ReviewEntry = {
  transactionId: string;
  fingerprint: string;
  state: 'pending' | 'suggested' | 'rejected' | 'retry' | 'abstained';
  suggestion?: Suggestion;
  attempts: number;
  retryAt?: number;
};
export type Decision = {
  id: string;
  transactionId: string;
  account: string;
  payee: string | null;
  direction: 'income' | 'expense';
  previous: string | null;
  category: string;
  fingerprint: string;
  suggestion?: Suggestion;
  status: 'applying' | 'applied' | 'undoing' | 'undone' | 'conflicted';
  createdAt: string;
};
export type ReviewState = {
  version: 1;
  scope: string;
  entries: ReviewEntry[];
  decisions: Decision[];
};
export type ReviewLedger = {
  transactions(): Promise<ReviewTransaction[]>;
  categories(): Promise<ReviewCategory[]>;
  setCategory(transactionId: string, category: string | null): Promise<void>;
};
export type ReviewPersistence = { state: ReviewState; save(): void };
export type LocalModel = {
  suggest(
    transaction: ReviewTransaction,
    categories: ReviewCategory[],
  ): Promise<Suggestion | null>;
};
