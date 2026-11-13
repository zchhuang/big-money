import type Database from 'better-sqlite3';

export function createFinancialSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE financial_accounts (
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      actual_account_id TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(file_id, id),
      UNIQUE(file_id, actual_account_id)
    );
    CREATE TABLE financial_account_sources (
      file_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      PRIMARY KEY(file_id, provider, connection_id, external_id),
      FOREIGN KEY(file_id, account_id) REFERENCES financial_accounts(file_id, id) ON DELETE CASCADE
    );
    CREATE TABLE financial_transactions (
      file_id TEXT NOT NULL,
      id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      actual_transaction_id TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(file_id, id),
      UNIQUE(file_id, actual_transaction_id),
      FOREIGN KEY(file_id, account_id) REFERENCES financial_accounts(file_id, id) ON DELETE CASCADE
    );
    CREATE TABLE financial_transaction_sources (
      file_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      PRIMARY KEY(file_id, provider, connection_id, external_id),
      FOREIGN KEY(file_id, transaction_id) REFERENCES financial_transactions(file_id, id) ON DELETE CASCADE
    );
    CREATE TABLE financial_observations (
      file_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      transaction_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(file_id, provider, connection_id, external_id, version),
      FOREIGN KEY(file_id, transaction_id) REFERENCES financial_transactions(file_id, id) ON DELETE CASCADE
    );
  `);
}
export function dropFinancialSchema(db: Database.Database) {
  db.exec(
    'DROP TABLE financial_observations; DROP TABLE financial_transaction_sources; DROP TABLE financial_transactions; DROP TABLE financial_account_sources; DROP TABLE financial_accounts;',
  );
}
