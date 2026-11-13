import type { AccountBase, Transaction } from 'plaid/legacy';

import type {
  AccountDefinition,
  Currency,
  FinancialAccount,
  Json,
  Observation,
} from './models';
import { decimalToMoney } from './money';

// Currency precision is explicit: the provider's currency symbol/code alone is
// insufficient to infer safe units (including unofficial currencies).
export function plaidAccount(
  account: AccountBase,
  currency: Currency,
): AccountDefinition {
  if (
    (account.balances.iso_currency_code ??
      account.balances.unofficial_currency_code) !== currency.code
  ) {
    throw new Error('financial-account-currency-mismatch');
  }
  const type =
    account.type === 'depository'
      ? 'bank'
      : account.type === 'credit'
        ? 'credit_card'
        : account.type === 'loan'
          ? 'loan'
          : account.type === 'investment'
            ? 'investment'
            : 'other';
  return { name: account.name, type, currency };
}
export function plaidTransaction(
  transaction: Pick<
    Transaction,
    | 'transaction_id'
    | 'account_id'
    | 'date'
    | 'datetime'
    | 'amount'
    | 'name'
    | 'merchant_name'
    | 'iso_currency_code'
    | 'unofficial_currency_code'
    | 'pending'
    | 'pending_transaction_id'
  >,
  account: FinancialAccount,
  version: number,
  observedAt: string,
): Observation {
  const code =
    transaction.iso_currency_code ?? transaction.unofficial_currency_code;
  if (code !== account.currency.code) {
    throw new Error('financial-account-currency-mismatch');
  }
  // Plaid reports expenses as positive; canonical/Actual cash flows are negative.
  const amount = decimalToMoney(String(transaction.amount), account.currency);
  amount.minor = (-BigInt(amount.minor)).toString();
  const raw: Json = JSON.parse(JSON.stringify(transaction));
  return {
    externalId: transaction.transaction_id,
    accountId: account.id,
    sourceAccountId: transaction.account_id,
    version,
    observedAt,
    date: transaction.date,
    ...(transaction.datetime ? { bookedAt: transaction.datetime } : {}),
    amount,
    description: transaction.merchant_name ?? transaction.name,
    status: transaction.pending ? 'pending' : 'posted',
    verification: 'verified',
    ...(transaction.pending_transaction_id
      ? { replacesExternalId: transaction.pending_transaction_id }
      : {}),
    raw,
  };
}
