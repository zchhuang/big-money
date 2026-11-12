import type {
  AccountBase,
  AuthGetResponse,
  CreditCardLiability,
  Holding,
  IdentityGetResponse,
  InvestmentTransaction,
  MortgageLiability,
  Security,
  StudentLoan,
  Transaction,
} from 'plaid/legacy';

// Preserve Plaid's full account/subtype, currency, balance and product schemas.
// These are provider records, not Actual ledger entries: Plaid transactions
// have the opposite cash-flow sign convention and investments use quantities.
export type FinancialData = {
  account: AccountBase;
  transaction: Transaction;
  security: Security;
  holding: Holding;
  investment_transaction: InvestmentTransaction;
  liability: CreditCardLiability | MortgageLiability | StudentLoan;
  auth: AuthGetResponse;
  identity: IdentityGetResponse;
};
export type RecordKind = keyof FinancialData;
export type FinancialRecord = {
  [Kind in RecordKind]: {
    kind: Kind;
    id: string;
    accountId?: string;
    data: FinancialData[Kind];
  };
}[RecordKind];
