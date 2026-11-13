import * as api from '@actual-app/api';

import type { ReviewLedger, ReviewTransaction } from './types';

export function createActualReviewLedger({
  start = '1900-01-01',
  end = '9999-12-31',
  accountId,
}: { start?: string; end?: string; accountId?: string } = {}): ReviewLedger {
  return {
    async transactions() {
      const [accounts, payees] = await Promise.all([
        api.getAccounts(),
        api.getPayees(),
      ]);
      const names = new Map(payees.map(p => [p.id, p]));
      const result: ReviewTransaction[] = [];
      for (const account of accounts.filter(
        a => !a.offbudget && !a.closed && (!accountId || a.id === accountId),
      )) {
        const transactions = await api.getTransactions(account.id, start, end);
        for (const parent of transactions) {
          for (const tx of parent.subtransactions?.length
            ? parent.subtransactions
            : [parent]) {
            const payee = tx.payee ? names.get(tx.payee) : undefined;
            result.push({
              id: tx.id,
              account: account.id,
              payee: tx.payee ?? null,
              merchant: payee?.name ?? tx.imported_payee ?? '',
              amount: tx.amount,
              date: tx.date,
              category: tx.category ?? null,
              importedId: tx.imported_id,
              eligible:
                !tx.is_parent &&
                !tx.tombstone &&
                !tx.starting_balance_flag &&
                !tx.transfer_id &&
                !payee?.transfer_acct &&
                tx.amount !== 0,
            });
          }
        }
      }
      return result;
    },
    async categories() {
      return (await api.getCategories())
        .filter(c => !c.hidden)
        .map(c => ({ id: c.id, name: c.name, income: !!c.is_income }));
    },
    async setCategory(id, category) {
      // Actual's wire protocol accepts null to clear a category. Its public
      // update type only models optional strings, so use a JSON field map.
      const fields: Record<string, string | null> = { category };
      await api.updateTransaction(id, fields);
    },
  };
}
