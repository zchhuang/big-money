import type Database from 'better-sqlite3';

import type {
  AccountDefinition,
  FinancialAccount,
  FinancialTransaction,
  Observation,
  Source,
  StoredFinancialTransaction,
  Vault,
} from './models';

type AccountRow = {
  id: string;
  payload: string;
  actual_account_id: string | null;
};
type TransactionRow = {
  id: string;
  payload: string;
  actual_transaction_id: string | null;
};

// SQL, encryption, and budget scoping only. The service owns financial decisions.
export function createFinancialRepository(
  db: Database.Database,
  vault: Vault,
  fileId: string,
) {
  function context(...parts: (string | number)[]) {
    return JSON.stringify(['financial-v1', fileId, ...parts]);
  }
  function open<T>(ciphertext: string, ...parts: (string | number)[]): T {
    // Only this repository writes these authenticated, encrypted typed records.
    return vault.open(ciphertext, context(...parts)) as T;
  }
  function accountValue(row: AccountRow): FinancialAccount {
    return {
      ...open<AccountDefinition>(row.payload, 'account', row.id),
      id: row.id,
      actualAccountId: row.actual_account_id,
    };
  }
  function transactionValue(row: TransactionRow): StoredFinancialTransaction {
    return {
      value: open<FinancialTransaction>(row.payload, 'transaction', row.id),
      actualTransactionId: row.actual_transaction_id,
    };
  }
  return {
    assertActiveBudget() {
      if (
        !db.prepare('SELECT id FROM files WHERE id=? AND deleted=0').get(fileId)
      ) {
        throw new Error('financial-budget-not-active');
      }
    },
    atomic<T>(operation: () => T): T {
      return db.transaction(operation)();
    },
    account(id: string) {
      const row = db
        .prepare<unknown[], AccountRow>(
          'SELECT id,payload,actual_account_id FROM financial_accounts WHERE file_id=? AND id=?',
        )
        .get(fileId, id);
      return row ? accountValue(row) : undefined;
    },
    accounts() {
      return db
        .prepare<unknown[], AccountRow>(
          'SELECT id,payload,actual_account_id FROM financial_accounts WHERE file_id=? ORDER BY id',
        )
        .all(fileId)
        .map(accountValue);
    },
    accountSource(source: Source, externalId: string) {
      return db
        .prepare<unknown[], { account_id: string }>(
          'SELECT account_id FROM financial_account_sources WHERE file_id=? AND provider=? AND connection_id=? AND external_id=?',
        )
        .get(fileId, source.provider, source.connectionId, externalId)
        ?.account_id;
    },
    insertAccount(id: string, definition: AccountDefinition) {
      db.prepare(
        'INSERT INTO financial_accounts(file_id,id,payload) VALUES (?,?,?)',
      ).run(fileId, id, vault.seal(definition, context('account', id)));
    },
    insertAccountSource(source: Source, externalId: string, id: string) {
      db.prepare(
        'INSERT OR IGNORE INTO financial_account_sources(file_id,provider,connection_id,external_id,account_id) VALUES (?,?,?,?,?)',
      ).run(fileId, source.provider, source.connectionId, externalId, id);
    },
    mapAccount(id: string, actualId: string) {
      db.prepare(
        'UPDATE financial_accounts SET actual_account_id=? WHERE file_id=? AND id=?',
      ).run(actualId, fileId, id);
    },
    transactionRecord(id: string) {
      const row = db
        .prepare<unknown[], TransactionRow>(
          'SELECT id,payload,actual_transaction_id FROM financial_transactions WHERE file_id=? AND id=?',
        )
        .get(fileId, id);
      return row ? transactionValue(row) : undefined;
    },
    transactions() {
      return db
        .prepare<unknown[], TransactionRow>(
          'SELECT id,payload,actual_transaction_id FROM financial_transactions WHERE file_id=? ORDER BY id',
        )
        .all(fileId)
        .map(transactionValue);
    },
    transactionSource(source: Source, externalId: string) {
      return db
        .prepare<unknown[], { transaction_id: string }>(
          'SELECT transaction_id FROM financial_transaction_sources WHERE file_id=? AND provider=? AND connection_id=? AND external_id=?',
        )
        .get(fileId, source.provider, source.connectionId, externalId)
        ?.transaction_id;
    },
    insertTransactionSource(source: Source, externalId: string, id: string) {
      db.prepare(
        'INSERT OR IGNORE INTO financial_transaction_sources(file_id,provider,connection_id,external_id,transaction_id) VALUES (?,?,?,?,?)',
      ).run(fileId, source.provider, source.connectionId, externalId, id);
    },
    observationVersion(source: Source, externalId: string, version: number) {
      return db
        .prepare<unknown[], { transactionId: string; digest: string }>(
          'SELECT transaction_id AS transactionId,digest FROM financial_observations WHERE file_id=? AND provider=? AND connection_id=? AND external_id=? AND version=?',
        )
        .get(fileId, source.provider, source.connectionId, externalId, version);
    },
    saveTransaction(value: FinancialTransaction) {
      db.prepare(`INSERT INTO financial_transactions(file_id,id,account_id,payload) VALUES (?,?,?,?)
        ON CONFLICT(file_id,id) DO UPDATE SET payload=excluded.payload`).run(
        fileId,
        value.id,
        value.accountId,
        vault.seal(value, context('transaction', value.id)),
      );
    },
    insertObservation(
      source: Source,
      observation: Observation,
      id: string,
      digest: string,
    ) {
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
    },
    history(source: Source, externalId: string): Observation[] {
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
    mapTransaction(id: string, actualId: string) {
      db.prepare(
        'UPDATE financial_transactions SET actual_transaction_id=? WHERE file_id=? AND id=?',
      ).run(actualId, fileId, id);
    },
  };
}
export type FinancialRepository = ReturnType<typeof createFinancialRepository>;
