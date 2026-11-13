import { randomBytes } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVault } from '#plaid/vault';

import type { AccountDefinition, Observation, Source } from './models';
import { actualAmount, decimalToMoney } from './money';
import { plaidTransaction } from './plaid';
import { createFinancialSchema, dropFinancialSchema } from './schema';
import { createFinancialStore } from './store';

const currency = { code: 'USD', scale: 2 };
const source: Source = { provider: 'plaid', connectionId: 'sandbox-item-1' };
const time = '2026-11-12T12:00:00Z';
let db: Database.Database;
const vault = createVault(randomBytes(32));
let store: ReturnType<typeof createFinancialStore>;
let accountId: string;
function definition(
  type: AccountDefinition['type'] = 'bank',
): AccountDefinition {
  return { name: type, currency, type };
}
function observation(patch: Partial<Observation> = {}): Observation {
  return {
    externalId: 'purchase-1',
    sourceAccountId: 'account-1',
    accountId,
    version: 1,
    observedAt: time,
    date: '2026-11-11',
    amount: { ...currency, minor: '-1299' },
    description: 'Fixture merchant',
    status: 'posted',
    verification: 'verified',
    raw: { source: 'fixture', amount: '12.99' },
    ...patch,
  };
}
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(
    'CREATE TABLE files(id TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0);',
  );
  db.prepare('INSERT INTO files(id) VALUES (?), (?)').run(
    'budget-a',
    'budget-b',
  );
  createFinancialSchema(db);
  store = createFinancialStore(db, vault, 'budget-a');
  accountId = store.registerAccount(source, 'account-1', definition()).id;
});
afterEach(() => db.close());

describe('exact money', () => {
  it("parses minor units exactly and converts to Actual's hundredths only without loss", () => {
    expect(decimalToMoney('-0.29', currency).minor).toBe('-29');
    expect(decimalToMoney('0012.9900', currency).minor).toBe('1299');
    expect(
      actualAmount(decimalToMoney('1200', { code: 'JPY', scale: 0 })),
    ).toBe(120000);
    expect(
      actualAmount(decimalToMoney('1.230', { code: 'KWD', scale: 3 })),
    ).toBe(123);
    expect(() => decimalToMoney('1.001', currency)).toThrow('precision-loss');
    expect(() =>
      actualAmount(decimalToMoney('1.231', { code: 'KWD', scale: 3 })),
    ).toThrow('precision-loss');
    expect(() =>
      actualAmount({ ...currency, minor: '9007199254740992' }),
    ).toThrow('overflow');
    expect(() => decimalToMoney('1e3', currency)).toThrow('decimal');
  });
});

describe('accounts and ownership', () => {
  it('keeps identities stable across retries and explicitly maps a second source to the same account', () => {
    expect(store.registerAccount(source, 'account-1', definition()).id).toBe(
      accountId,
    );
    const csv = { provider: 'csv', connectionId: 'bank-statement' };
    expect(
      store.registerAccount(csv, 'export-account', definition(), accountId).id,
    ).toBe(accountId);
    store.mapAccount(accountId, 'actual-bank');
    expect(store.account(accountId).actualAccountId).toBe('actual-bank');
    expect(() => store.mapAccount(accountId, 'different-bank')).toThrow(
      'already-mapped',
    );
    expect(() =>
      store.registerAccount(
        csv,
        'export-account',
        definition('wallet'),
        accountId,
      ),
    ).toThrow('definition-conflict');
  });
  it('isolates identical source IDs by budget and connection and checks source-account ownership', () => {
    const other = createFinancialStore(db, vault, 'budget-b');
    expect(() => other.account(accountId)).toThrow('not-found');
    expect(() =>
      store.ingest(source, [observation({ sourceAccountId: 'wrong-account' })]),
    ).toThrow('source-account-not-mapped');
    const otherId = other.registerAccount(source, 'account-1', definition()).id;
    expect(otherId).not.toBe(accountId);
    const secondSource = { ...source, connectionId: 'another-item' };
    expect(() => store.ingest(secondSource, [observation()])).toThrow(
      'source-account-not-mapped',
    );
    expect(() =>
      store.ingest(source, [observation({ accountId: otherId })]),
    ).toThrow('not-found');
    db.prepare('UPDATE files SET deleted=1 WHERE id=?').run('budget-a');
    expect(() => store.transactions()).toThrow('budget-not-active');
  });
  it('preserves investment accounts but rejects flattening securities activity into cash transactions', () => {
    const investment = store.registerAccount(
      source,
      'brokerage',
      definition('investment'),
    );
    expect(investment.type).toBe('investment');
    expect(() =>
      store.ingest(source, [
        observation({ accountId: investment.id, sourceAccountId: 'brokerage' }),
      ]),
    ).toThrow('investment-requires-product-model');
  });
});

describe('atomic source ingestion', () => {
  it('replays idempotently, tolerates later receipt times, and preserves encrypted raw revisions', () => {
    const first = store.ingest(source, [observation()])[0];
    expect(
      store.ingest(source, [
        observation({ observedAt: '2026-11-12T13:00:00Z' }),
      ])[0],
    ).toMatchObject({ id: first.id, outcome: 'unchanged' });
    store.ingest(source, [
      observation({ version: 2, amount: { ...currency, minor: '-1499' } }),
    ]);
    expect(store.transactions()).toMatchObject([
      { id: first.id, amount: { minor: '-1499' } },
    ]);
    expect(store.history(source, 'purchase-1')).toHaveLength(2);
    expect(store.history(source, 'purchase-1')[0].raw).toEqual(
      observation().raw,
    );
    expect(
      JSON.stringify(
        db.prepare('SELECT payload FROM financial_observations').all(),
      ),
    ).not.toContain('Fixture merchant');
    const reopened = new Database(db.serialize());
    try {
      expect(
        createFinancialStore(reopened, vault, 'budget-a').transactions()[0].id,
      ).toBe(first.id);
    } finally {
      reopened.close();
    }
  });
  it('rejects conflicting source versions and rolls the entire batch back', () => {
    store.ingest(source, [observation()]);
    expect(() =>
      store.ingest(source, [
        observation({ externalId: 'new' }),
        observation({ description: 'changed with same version' }),
      ]),
    ).toThrow('source-version-conflict');
    expect(store.transactions()).toHaveLength(1);
    expect(store.history(source, 'new')).toHaveLength(0);
  });
  it('retains stale observations without regressing current financial state', () => {
    store.ingest(source, [observation({ version: 5 })]);
    expect(
      store.ingest(source, [
        observation({ version: 4, amount: { ...currency, minor: '-1' } }),
      ])[0].outcome,
    ).toBe('stale');
    expect(store.transactions()[0].amount.minor).toBe('-1299');
    expect(store.history(source, 'purchase-1').map(o => o.version)).toEqual([
      4, 5,
    ]);
  });
  it('links pending to posted and ignores removal of the old pending source ID', () => {
    const pending = store.ingest(source, [
      observation({ externalId: 'pending', status: 'pending' }),
    ])[0];
    store.mapAccount(accountId, 'actual-bank');
    expect(store.projection('USD').upserts).toHaveLength(0);
    const posted = store.ingest(source, [
      observation({
        externalId: 'posted',
        replacesExternalId: 'pending',
        version: 2,
      }),
    ])[0];
    expect(posted.id).toBe(pending.id);
    store.acknowledgeProjection(posted.id, 'actual-transaction');
    expect(
      store.ingest(source, [
        observation({ externalId: 'pending', version: 3, status: 'removed' }),
      ])[0].outcome,
    ).toBe('superseded');
    expect(store.projection('USD').deletions).toEqual([]);
    expect(store.projection('USD').upserts[0]).toMatchObject({
      canonicalId: pending.id,
      actualTransactionId: 'actual-transaction',
    });
    store.ingest(source, [
      observation({ externalId: 'posted', version: 4, status: 'removed' }),
    ]);
    expect(store.projection('USD').deletions).toEqual([
      { canonicalId: pending.id, actualTransactionId: 'actual-transaction' },
    ]);
  });
  it('accepts a posted replacement after pending removal in the same sync batch', () => {
    const pending = store.ingest(source, [
      observation({ externalId: 'pending', status: 'pending' }),
    ])[0];
    store.ingest(source, [
      observation({ externalId: 'pending', version: 2, status: 'removed' }),
    ]);
    const posted = store.ingest(source, [
      observation({
        externalId: 'posted',
        replacesExternalId: 'pending',
        version: 2,
      }),
    ])[0];
    expect(posted.id).toBe(pending.id);
    expect(store.transactions()[0].status).toBe('posted');
  });
  it('handles posted-before-pending ordering without creating a second transaction', () => {
    const posted = store.ingest(source, [
      observation({
        externalId: 'posted',
        replacesExternalId: 'pending',
        version: 2,
      }),
    ])[0];
    expect(
      store.ingest(source, [
        observation({ externalId: 'pending', status: 'pending', version: 1 }),
      ])[0],
    ).toMatchObject({ id: posted.id, outcome: 'stale' });
    expect(store.transactions()).toHaveLength(1);
  });
  it('supports an explicit pending-to-posted transition in the same source batch', () => {
    const results = store.ingest(source, [
      observation({ externalId: 'pending', status: 'pending' }),
      observation({ externalId: 'posted', replacesExternalId: 'pending' }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(store.transactions()[0].status).toBe('posted');
  });
  it('keeps two genuine same-amount purchases separate and rejects ambiguous pending links', () => {
    const [first, second] = store.ingest(source, [
      observation({ externalId: 'one' }),
      observation({ externalId: 'two' }),
    ]);
    expect(first.id).not.toBe(second.id);
    expect(() =>
      store.ingest(source, [
        observation({
          externalId: 'two',
          replacesExternalId: 'one',
          version: 2,
        }),
      ]),
    ).toThrow('pending-link-conflict');
  });
  it('rejects wrong currency, invalid dates, unsafe revisions and invalid raw data', () => {
    expect(() =>
      store.ingest(source, [
        observation({ amount: { code: 'EUR', scale: 2, minor: '-12' } }),
      ]),
    ).toThrow('currency-mismatch');
    expect(() =>
      store.ingest(source, [observation({ date: '2026-02-30' })]),
    ).toThrow('invalid-financial-date');
    expect(() => store.ingest(source, [observation({ version: 0.5 })])).toThrow(
      'version',
    );
    expect(() =>
      store.ingest(source, [observation({ raw: { amount: NaN } })]),
    ).toThrow('json');
    expect(store.transactions()).toEqual([]);
  });
  it('cascades budget deletion and reverses the schema', () => {
    store.ingest(source, [observation()]);
    db.prepare('DELETE FROM files WHERE id=?').run('budget-a');
    expect(db.prepare('SELECT * FROM financial_observations').all()).toEqual(
      [],
    );
    dropFinancialSchema(db);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'financial_%'")
        .all(),
    ).toEqual([]);
  });
});

describe('ledger projection', () => {
  it('projects bank/card/wallet fixtures without changing categories or silently matching transfers', () => {
    const sources = [
      source,
      { provider: 'plaid', connectionId: 'card' },
      { provider: 'gmail', connectionId: 'venmo' },
      { provider: 'paypal', connectionId: 'wallet' },
    ];
    const types = [
      'bank',
      'credit_card',
      'wallet',
      'wallet',
    ] satisfies AccountDefinition['type'][];
    for (let i = 0; i < sources.length; i++) {
      const account =
        i === 0
          ? store.account(accountId)
          : store.registerAccount(
              sources[i],
              'source-account',
              definition(types[i]),
            );
      store.mapAccount(account.id, `actual-${i}`);
      const input = observation({
        accountId: account.id,
        sourceAccountId: i === 0 ? 'account-1' : 'source-account',
        externalId: `fixture-${i}`,
      });
      store.ingest(sources[i], [input]);
      store.ingest(sources[i], [input]);
    }
    const plan = store.projection('USD');
    expect(plan.upserts).toHaveLength(4);
    expect(new Set(plan.upserts.map(p => p.transaction.imported_id)).size).toBe(
      4,
    );
    for (const change of plan.upserts) {
      expect(change.transaction.amount).toBe(-1299);
      expect(change.transaction).not.toHaveProperty('category');
      expect(change.transaction).not.toHaveProperty('notes');
      expect(change.transaction).not.toHaveProperty('transfer_id');
    }
  });
  it('excludes pending, unverified, unmapped and incompatible-currency data explicitly', () => {
    store.ingest(source, [observation()]);
    expect(store.projection('USD').excluded[0].reason).toBe('unmapped-account');
    store.mapAccount(accountId, 'actual-bank');
    expect(store.projection('EUR').excluded[0].reason).toBe(
      'currency-mismatch',
    );
    const current = store.transactions()[0];
    store.acknowledgeProjection(current.id, 'actual-tx');
    store.ingest(source, [
      observation({
        version: 2,
        status: 'removed',
        verification: 'unverified',
      }),
    ]);
    const plan = store.projection('USD');
    expect(plan.deletions).toEqual([]);
    expect(plan.excluded[0].reason).toBe('unverified');
  });
  it("normalizes Plaid's cash-flow signs and explicit pending relationship", () => {
    const account = store.account(accountId);
    const transaction = {
      transaction_id: 'posted',
      account_id: 'source-account',
      date: '2026-11-11',
      datetime: null,
      amount: 12.99,
      name: 'Test',
      merchant_name: null,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      pending: false,
      pending_transaction_id: 'pending',
    };
    // The SDK has many unrelated enrichment fields. Fixture only the input fields
    // this normalization reads; no actual Plaid network request is made.
    const value = plaidTransaction(transaction, account, 1, time);
    expect(value.amount.minor).toBe('-1299');
    expect(value.replacesExternalId).toBe('pending');
    expect(value.raw).toMatchObject({ amount: 12.99 });
  });
});
