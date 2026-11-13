import { createHash, randomUUID } from 'node:crypto';

import type {
  AccountDefinition,
  FinancialAccount,
  FinancialTransaction,
  IngestionResult,
  Observation,
  Source,
} from './models';
import { validateCurrency, validateMoney } from './money';
import { buildLedgerProjection } from './projection';
import type { FinancialRepository } from './repository';

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

export function createFinancialService(repository: FinancialRepository) {
  function account(id: string): FinancialAccount {
    const result = repository.account(id);
    if (!result) throw new Error('financial-account-not-found');
    return result;
  }
  function transaction(id: string) {
    const result = repository.transactionRecord(id);
    if (!result) throw new Error('financial-transaction-not-found');
    return result;
  }
  function writeAlias(source: Source, externalId: string, id: string) {
    const previous = repository.transactionSource(source, externalId);
    if (previous && previous !== id) {
      throw new Error('financial-source-conflict');
    }
    repository.insertTransactionSource(source, externalId, id);
  }
  return {
    registerAccount(
      source: Source,
      externalId: string,
      definition: AccountDefinition,
      canonicalId?: string,
    ): FinancialAccount {
      repository.assertActiveBudget();
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
      return repository.atomic(() => {
        const previous = repository.accountSource(source, externalId);
        if (previous && canonicalId && previous !== canonicalId) {
          throw new Error('financial-account-already-mapped');
        }
        const id = previous ?? canonicalId ?? randomUUID();
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
          repository.insertAccount(id, definition);
        }
        repository.insertAccountSource(source, externalId, id);
        return account(id);
      });
    },
    resolveAccount(source: Source, externalId: string): FinancialAccount {
      repository.assertActiveBudget();
      validateSource(source);
      identifier(externalId);
      const id = repository.accountSource(source, externalId);
      if (!id) throw new Error('financial-source-account-not-mapped');
      return account(id);
    },
    account(id: string) {
      repository.assertActiveBudget();
      return account(id);
    },
    mapAccount(id: string, actualId: string) {
      repository.assertActiveBudget();
      identifier(actualId);
      const existing = account(id);
      if (existing.actualAccountId && existing.actualAccountId !== actualId) {
        throw new Error('financial-account-already-mapped');
      }
      repository.mapAccount(id, actualId);
    },
    ingest(source: Source, observations: Observation[]): IngestionResult[] {
      repository.assertActiveBudget();
      validateSource(source);
      return repository.atomic(() =>
        observations.map((observation): IngestionResult => {
          validateObservation(observation);
          const acct = account(observation.accountId);
          if (
            repository.accountSource(source, observation.sourceAccountId) !==
            observation.accountId
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
          // Receipt time may change on retry; source content and version may not.
          const { observedAt: _observedAt, ...content } = observation;
          const digest = createHash('sha256')
            .update(stable(content))
            .digest('hex');
          const old = repository.observationVersion(
            source,
            observation.externalId,
            observation.version,
          );
          if (old) {
            if (old.digest !== digest) {
              throw new Error('financial-source-version-conflict');
            }
            return {
              externalId: observation.externalId,
              id: old.transactionId,
              outcome: 'unchanged',
            };
          }
          const direct = repository.transactionSource(
            source,
            observation.externalId,
          );
          const replaced = observation.replacesExternalId
            ? repository.transactionSource(
                source,
                observation.replacesExternalId,
              )
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
            repository.saveTransaction(value);
          }
          writeAlias(source, observation.externalId, id);
          if (observation.replacesExternalId) {
            writeAlias(source, observation.replacesExternalId, id);
          }
          repository.insertObservation(source, observation, id, digest);
          return { externalId: observation.externalId, id, outcome };
        }),
      );
    },
    transactions(): FinancialTransaction[] {
      repository.assertActiveBudget();
      return repository.transactions().map(record => record.value);
    },
    history(source: Source, externalId: string): Observation[] {
      repository.assertActiveBudget();
      validateSource(source);
      identifier(externalId);
      return repository.history(source, externalId);
    },
    acknowledgeProjection(id: string, actualTransactionId: string) {
      repository.assertActiveBudget();
      identifier(actualTransactionId);
      const existing = transaction(id);
      if (
        existing.actualTransactionId &&
        existing.actualTransactionId !== actualTransactionId
      ) {
        throw new Error('financial-transaction-already-mapped');
      }
      repository.mapTransaction(id, actualTransactionId);
    },
    projection(budgetCurrency: string) {
      repository.assertActiveBudget();
      return buildLedgerProjection(
        repository.transactions(),
        new Map(repository.accounts().map(acct => [acct.id, acct])),
        budgetCurrency,
      );
    },
  };
}
