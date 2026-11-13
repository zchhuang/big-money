import { createHash, randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  AccountDefinition,
  FinancialAccount,
  FinancialTransaction,
  IngestionResult,
  LedgerProjection,
  Observation,
  Source,
  Vault,
} from './models';
import { actualAmount, validateCurrency, validateMoney } from './money';

// Deterministic representation makes source retries independent of JSON key order.
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('invalid-financial-json');
    }
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error('invalid-financial-json');
    return result;
  }
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error('invalid-financial-json');
  }
  return (
    '{' +
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => JSON.stringify(key) + ':' + stable(entry))
      .join(',') +
    '}'
  );
}
function identifier(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new Error('invalid-financial-identifier');
  }
}
function validateSource(source: Source) {
  identifier(source.provider);
  identifier(source.connectionId);
}
function validateObservation(observation: Observation) {
  identifier(observation.externalId);
  identifier(observation.accountId);
  identifier(observation.sourceAccountId);
  if (!Number.isSafeInteger(observation.version) || observation.version < 0) {
    throw new Error('invalid-financial-version');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(observation.date) ||
    Number.isNaN(Date.parse(observation.date)) ||
    new Date(observation.date).toISOString().slice(0, 10) !== observation.date
  ) {
    throw new Error('invalid-financial-date');
  }
  if (typeof observation.observedAt !== 'string') {
    throw new Error('invalid-financial-timestamp');
  }
  if (observation.replacesExternalId === observation.externalId) {
    throw new Error('financial-pending-link-conflict');
  }
  for (const value of [observation.observedAt, observation.bookedAt]) {
    if (
      value !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
        Number.isNaN(Date.parse(value)))
    ) {
      throw new Error('invalid-financial-timestamp');
    }
  }
  if (
    !['pending', 'posted', 'removed'].includes(observation.status) ||
    !['verified', 'unverified'].includes(observation.verification) ||
    typeof observation.description !== 'string'
  ) {
    throw new Error('invalid-financial-observation');
  }
  if (observation.replacesExternalId) {
    identifier(observation.replacesExternalId);
  }
  validateMoney(observation.amount);
}
type TransactionRow = {
  id: string;
  payload: string;
  actual_transaction_id: string | null;
};

// fileId is an already-authorized server budget ID. This module is internal:
// the HTTP/job caller must establish access before constructing its scoped handle.
export function createFinancialStore(
  db: Database.Database,
  vault: Vault,
  fileId: string,
) {
  identifier(fileId);
  function active() {
    if (
      !db
        .prepare('SELECT id FROM files WHERE id = ? AND deleted = 0')
        .get(fileId)
    ) {
      throw new Error('financial-budget-not-active');
    }
  }
  function context(...parts: (string | number)[]) {
    return JSON.stringify(['financial-v1', fileId, ...parts]);
  }
  function open<T>(ciphertext: string, ...parts: (string | number)[]): T {
    // Only this module writes these authenticated, encrypted typed records.
    return vault.open(ciphertext, context(...parts)) as T;
  }
  function account(id: string): FinancialAccount {
    const row = db
      .prepare<
        unknown[],
        { payload: string; actual_account_id: string | null }
      >(
        'SELECT payload, actual_account_id FROM financial_accounts WHERE file_id = ? AND id = ?',
      )
      .get(fileId, id);
    if (!row) throw new Error('financial-account-not-found');
    return {
      ...open<AccountDefinition>(row.payload, 'account', id),
      id,
      actualAccountId: row.actual_account_id,
    };
  }
  function transaction(id: string) {
    const row = db
      .prepare<unknown[], TransactionRow>(
        'SELECT id, payload, actual_transaction_id FROM financial_transactions WHERE file_id = ? AND id = ?',
      )
      .get(fileId, id);
    if (!row) throw new Error('financial-transaction-not-found');
    return {
      row,
      value: open<FinancialTransaction>(row.payload, 'transaction', id),
    };
  }
  function alias(source: Source, externalId: string) {
    return db
      .prepare<unknown[], { transaction_id: string }>(
        'SELECT transaction_id FROM financial_transaction_sources WHERE file_id=? AND provider=? AND connection_id=? AND external_id=?',
      )
      .get(fileId, source.provider, source.connectionId, externalId)
      ?.transaction_id;
  }
  function writeAlias(source: Source, externalId: string, id: string) {
    const previous = alias(source, externalId);
    if (previous && previous !== id) {
      throw new Error('financial-source-conflict');
    }
    db.prepare(
      'INSERT OR IGNORE INTO financial_transaction_sources(file_id,provider,connection_id,external_id,transaction_id) VALUES (?,?,?,?,?)',
    ).run(fileId, source.provider, source.connectionId, externalId, id);
  }
  return {
    registerAccount(
      source: Source,
      externalId: string,
      definition: AccountDefinition,
      canonicalId?: string,
    ): FinancialAccount {
      active();
      validateSource(source);
      identifier(externalId);
      identifier(definition.name);
      validateCurrency(definition.currency);
      if (
        ![
          'bank',
          'credit_card',
          'wallet',
          'loan',
          'investment',
          'other',
        ].includes(definition.type)
      ) {
        throw new Error('invalid-financial-account-type');
      }
      return db.transaction(() => {
        const previous = db
          .prepare<unknown[], { account_id: string }>(
            'SELECT account_id FROM financial_account_sources WHERE file_id=? AND provider=? AND connection_id=? AND external_id=?',
          )
          .get(fileId, source.provider, source.connectionId, externalId);
        if (previous && canonicalId && previous.account_id !== canonicalId) {
          throw new Error('financial-account-already-mapped');
        }
        const id = previous?.account_id ?? canonicalId ?? randomUUID();
        if (previous || canonicalId) {
          const existing = account(id);
          if (
            existing.type !== definition.type ||
            existing.currency.code !== definition.currency.code ||
            existing.currency.scale !== definition.currency.scale
          ) {
            throw new Error('financial-account-definition-conflict');
          }
        } else {
          db.prepare(
            'INSERT INTO financial_accounts(file_id,id,payload) VALUES (?,?,?)',
          ).run(fileId, id, vault.seal(definition, context('account', id)));
        }
        db.prepare(
          'INSERT OR IGNORE INTO financial_account_sources(file_id,provider,connection_id,external_id,account_id) VALUES (?,?,?,?,?)',
        ).run(fileId, source.provider, source.connectionId, externalId, id);
        return account(id);
      })();
    },
    resolveAccount(source: Source, externalId: string): FinancialAccount {
      active();
      validateSource(source);
      identifier(externalId);
      const row = db
        .prepare<unknown[], { account_id: string }>(
          'SELECT account_id FROM financial_account_sources WHERE file_id=? AND provider=? AND connection_id=? AND external_id=?',
        )
        .get(fileId, source.provider, source.connectionId, externalId);
      if (!row) throw new Error('financial-source-account-not-mapped');
      return account(row.account_id);
    },
    account(id: string) {
      active();
      return account(id);
    },
    mapAccount(id: string, actualId: string) {
      active();
      identifier(actualId);
      account(id);
      const row = account(id);
      if (row.actualAccountId && row.actualAccountId !== actualId) {
        throw new Error('financial-account-already-mapped');
      }
      db.prepare(
        'UPDATE financial_accounts SET actual_account_id=? WHERE file_id=? AND id=?',
      ).run(actualId, fileId, id);
    },
    ingest(source: Source, observations: Observation[]): IngestionResult[] {
      active();
      validateSource(source);
      return db.transaction(() =>
        observations.map((observation): IngestionResult => {
          validateObservation(observation);
          const acct = account(observation.accountId);
          if (
            !db
              .prepare(
                'SELECT account_id FROM financial_account_sources WHERE file_id=? AND provider=? AND connection_id=? AND external_id=? AND account_id=?',
              )
              .get(
                fileId,
                source.provider,
                source.connectionId,
                observation.sourceAccountId,
                observation.accountId,
              )
          ) {
            throw new Error('financial-source-account-not-mapped');
          }
          if (acct.type === 'investment') {
            throw new Error('financial-investment-requires-product-model');
          }
          if (
            acct.currency.code !== observation.amount.code ||
            acct.currency.scale !== observation.amount.scale
          ) {
            throw new Error('financial-account-currency-mismatch');
          }
          // observedAt is receipt metadata; retries may receive the same source
          // version at a later wall-clock time without changing its content.
          const { observedAt: _observedAt, ...content } = observation;
          const digest = createHash('sha256')
            .update(stable(content))
            .digest('hex');
          const old = db
            .prepare<unknown[], { transaction_id: string; digest: string }>(
              'SELECT transaction_id,digest FROM financial_observations WHERE file_id=? AND provider=? AND connection_id=? AND external_id=? AND version=?',
            )
            .get(
              fileId,
              source.provider,
              source.connectionId,
              observation.externalId,
              observation.version,
            );
          if (old) {
            if (old.digest !== digest) {
              throw new Error('financial-source-version-conflict');
            }
            return {
              externalId: observation.externalId,
              id: old.transaction_id,
              outcome: 'unchanged',
            };
          }
          const direct = alias(source, observation.externalId);
          const replaced = observation.replacesExternalId
            ? alias(source, observation.replacesExternalId)
            : undefined;
          if (direct && replaced && direct !== replaced) {
            throw new Error('financial-pending-link-conflict');
          }
          const id = direct ?? replaced ?? randomUUID();
          const current = direct || replaced ? transaction(id).value : null;
          if (current && current.accountId !== observation.accountId) {
            throw new Error('financial-transaction-account-conflict');
          }
          let outcome: IngestionResult['outcome'] = current
            ? 'updated'
            : 'created';
          if (current && observation.version < current.version) {
            outcome = 'stale';
          } else if (
            current &&
            observation.externalId !== current.externalId &&
            !observation.replacesExternalId
          ) {
            outcome = 'superseded';
          } else if (
            current &&
            current.settlement === 'posted' &&
            observation.status === 'pending'
          ) {
            outcome = 'superseded';
          } else if (replaced && !direct && current?.settlement !== 'pending') {
            throw new Error('financial-pending-link-conflict');
          } else if (
            current &&
            observation.version === current.version &&
            !(
              replaced &&
              current.settlement === 'pending' &&
              observation.status === 'posted'
            )
          ) {
            throw new Error('financial-source-version-conflict');
          }
          if (outcome === 'created' || outcome === 'updated') {
            const {
              raw: _raw,
              replacesExternalId: _replaces,
              ...data
            } = observation;
            const value: FinancialTransaction = {
              ...data,
              id,
              source,
              settlement:
                observation.status === 'removed'
                  ? (current?.settlement ?? 'posted')
                  : observation.status,
            };
            db.prepare(`INSERT INTO financial_transactions(file_id,id,account_id,payload) VALUES (?,?,?,?)
            ON CONFLICT(file_id,id) DO UPDATE SET payload=excluded.payload`).run(
              fileId,
              id,
              observation.accountId,
              vault.seal(value, context('transaction', id)),
            );
          }
          writeAlias(source, observation.externalId, id);
          if (observation.replacesExternalId) {
            writeAlias(source, observation.replacesExternalId, id);
          }
          db.prepare(
            'INSERT INTO financial_observations(file_id,provider,connection_id,external_id,version,transaction_id,digest,payload) VALUES (?,?,?,?,?,?,?,?)',
          ).run(
            fileId,
            source.provider,
            source.connectionId,
            observation.externalId,
            observation.version,
            id,
            digest,
            vault.seal(
              observation,
              context(
                'observation',
                source.provider,
                source.connectionId,
                observation.externalId,
                observation.version,
              ),
            ),
          );
          return { externalId: observation.externalId, id, outcome };
        }),
      )();
    },
    transactions(): FinancialTransaction[] {
      active();
      return db
        .prepare<unknown[], { id: string; payload: string }>(
          'SELECT id,payload FROM financial_transactions WHERE file_id=? ORDER BY id',
        )
        .all(fileId)
        .map(row =>
          open<FinancialTransaction>(row.payload, 'transaction', row.id),
        );
    },
    history(source: Source, externalId: string): Observation[] {
      active();
      validateSource(source);
      identifier(externalId);
      return db
        .prepare<unknown[], { version: number; payload: string }>(
          'SELECT version,payload FROM financial_observations WHERE file_id=? AND provider=? AND connection_id=? AND external_id=? ORDER BY version',
        )
        .all(fileId, source.provider, source.connectionId, externalId)
        .map(row =>
          open<Observation>(
            row.payload,
            'observation',
            source.provider,
            source.connectionId,
            externalId,
            row.version,
          ),
        );
    },
    acknowledgeProjection(id: string, actualTransactionId: string) {
      active();
      identifier(actualTransactionId);
      const { row } = transaction(id);
      if (
        row.actual_transaction_id &&
        row.actual_transaction_id !== actualTransactionId
      ) {
        throw new Error('financial-transaction-already-mapped');
      }
      db.prepare(
        'UPDATE financial_transactions SET actual_transaction_id=? WHERE file_id=? AND id=?',
      ).run(actualTransactionId, fileId, id);
    },
    projection(budgetCurrency: string): LedgerProjection {
      active();
      const plan: LedgerProjection = {
        upserts: [],
        deletions: [],
        excluded: [],
      };
      const rows = db
        .prepare<unknown[], TransactionRow>(
          'SELECT id,payload,actual_transaction_id FROM financial_transactions WHERE file_id=? ORDER BY id',
        )
        .all(fileId);
      for (const row of rows) {
        const value = open<FinancialTransaction>(
          row.payload,
          'transaction',
          row.id,
        );
        if (value.verification === 'unverified') {
          plan.excluded.push({ canonicalId: row.id, reason: 'unverified' });
          continue;
        }
        if (value.status === 'removed') {
          if (row.actual_transaction_id) {
            plan.deletions.push({
              canonicalId: row.id,
              actualTransactionId: row.actual_transaction_id,
            });
          }
          continue;
        }
        if (value.status === 'pending') {
          plan.excluded.push({ canonicalId: row.id, reason: 'pending' });
          continue;
        }
        const acct = account(value.accountId);
        if (!acct.actualAccountId) {
          plan.excluded.push({
            canonicalId: row.id,
            reason: 'unmapped-account',
          });
          continue;
        }
        if (value.amount.code !== budgetCurrency) {
          plan.excluded.push({
            canonicalId: row.id,
            reason: 'currency-mismatch',
          });
          continue;
        }
        let amount: number;
        try {
          amount = actualAmount(value.amount);
        } catch {
          plan.excluded.push({
            canonicalId: row.id,
            reason: 'amount-not-representable',
          });
          continue;
        }
        plan.upserts.push({
          canonicalId: row.id,
          actualTransactionId: row.actual_transaction_id,
          transaction: {
            account: acct.actualAccountId,
            date: value.date,
            amount,
            imported_id: `big-money:${row.id}`,
            imported_payee: value.description,
            cleared: true,
          },
        });
      }
      return plan;
    },
  };
}
