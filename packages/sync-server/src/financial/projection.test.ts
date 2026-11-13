import { describe, expect, it } from 'vitest';

import type {
  FinancialAccount,
  FinancialTransaction,
  StoredFinancialTransaction,
} from './models';
import { buildLedgerProjection } from './projection';

const account: FinancialAccount = {
  id: 'bank',
  name: 'Fixture bank',
  type: 'bank',
  currency: { code: 'USD', scale: 2 },
  actualAccountId: 'actual-bank',
};
const value: FinancialTransaction = {
  id: 'purchase',
  source: { provider: 'fixture', connectionId: 'bank' },
  externalId: 'source-purchase',
  sourceAccountId: 'source-bank',
  accountId: account.id,
  version: 1,
  observedAt: '2026-11-12T12:00:00Z',
  date: '2026-11-11',
  amount: { code: 'USD', scale: 2, minor: '-1299' },
  description: 'Fixture purchase',
  status: 'posted',
  verification: 'verified',
  settlement: 'posted',
};
function record(
  patch: Partial<FinancialTransaction> = {},
  actualTransactionId: string | null = null,
): StoredFinancialTransaction {
  return { value: { ...value, ...patch }, actualTransactionId };
}
describe('pure ledger projection', () => {
  it('uses only supplied values, keeps inputs unchanged, and preserves user-owned fields', () => {
    const entries = [record()];
    const accounts = new Map([[account.id, account]]);
    const before = JSON.stringify([entries, [...accounts]]);
    const plan = buildLedgerProjection(entries, accounts, 'USD');
    expect(plan.upserts).toMatchObject([
      {
        canonicalId: 'purchase',
        transaction: {
          account: 'actual-bank',
          amount: -1299,
          imported_id: 'big-money:purchase',
        },
      },
    ]);
    expect(plan.upserts[0].transaction).not.toHaveProperty('category');
    expect(plan.upserts[0].transaction).not.toHaveProperty('notes');
    expect(JSON.stringify([entries, [...accounts]])).toBe(before);
    expect(buildLedgerProjection(entries, accounts, 'USD')).toEqual(plan);
  });
  it('returns pending/unverified exclusions and safe deletion instructions without storage', () => {
    const result = buildLedgerProjection(
      [
        record({ id: 'pending', status: 'pending' }),
        record(
          { id: 'unverified', status: 'removed', verification: 'unverified' },
          'existing',
        ),
        record({ id: 'removed', status: 'removed' }, 'existing-removed'),
      ],
      new Map(),
      'USD',
    );
    expect(result.excluded).toEqual([
      { canonicalId: 'pending', reason: 'pending' },
      { canonicalId: 'unverified', reason: 'unverified' },
    ]);
    expect(result.deletions).toEqual([
      { canonicalId: 'removed', actualTransactionId: 'existing-removed' },
    ]);
    expect(result.upserts).toEqual([]);
  });
  it('excludes incompatible money and unmapped accounts without silently rounding', () => {
    const entries = [
      record({ id: 'fx', amount: { code: 'EUR', scale: 2, minor: '100' } }),
      record({
        id: 'precision',
        amount: { code: 'USD', scale: 3, minor: '1231' },
      }),
      record({ id: 'unmapped', accountId: 'unmapped' }),
    ];
    const result = buildLedgerProjection(
      entries,
      new Map([
        [account.id, account],
        ['unmapped', { ...account, id: 'unmapped', actualAccountId: null }],
      ]),
      'USD',
    );
    expect(result.excluded.map(e => e.reason)).toEqual([
      'currency-mismatch',
      'amount-not-representable',
      'unmapped-account',
    ]);
  });
});
