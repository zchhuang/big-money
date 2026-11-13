import type {
  FinancialAccount,
  LedgerProjection,
  StoredFinancialTransaction,
} from './models';
import { actualAmount } from './money';

// Pure conversion: no database, provider calls, or ledger mutations.
export function buildLedgerProjection(
  entries: readonly StoredFinancialTransaction[],
  accounts: ReadonlyMap<string, FinancialAccount>,
  budgetCurrency: string,
): LedgerProjection {
  const plan: LedgerProjection = {
    upserts: [],
    deletions: [],
    excluded: [],
  };
  for (const { value, actualTransactionId } of entries) {
    if (value.verification === 'unverified') {
      plan.excluded.push({ canonicalId: value.id, reason: 'unverified' });
      continue;
    }
    if (value.status === 'removed') {
      if (actualTransactionId) {
        plan.deletions.push({
          canonicalId: value.id,
          actualTransactionId,
        });
      }
      continue;
    }
    if (value.status === 'pending') {
      plan.excluded.push({ canonicalId: value.id, reason: 'pending' });
      continue;
    }
    const acct = accounts.get(value.accountId);
    if (!acct) throw new Error('financial-account-not-found');
    if (!acct.actualAccountId) {
      plan.excluded.push({
        canonicalId: value.id,
        reason: 'unmapped-account',
      });
      continue;
    }
    if (value.amount.code !== budgetCurrency) {
      plan.excluded.push({
        canonicalId: value.id,
        reason: 'currency-mismatch',
      });
      continue;
    }
    let amount: number;
    try {
      amount = actualAmount(value.amount);
    } catch {
      plan.excluded.push({
        canonicalId: value.id,
        reason: 'amount-not-representable',
      });
      continue;
    }
    plan.upserts.push({
      canonicalId: value.id,
      actualTransactionId,
      transaction: {
        account: acct.actualAccountId,
        date: value.date,
        amount,
        imported_id: `big-money:${value.id}`,
        imported_payee: value.description,
        cleared: true,
      },
    });
  }
  return plan;
}
