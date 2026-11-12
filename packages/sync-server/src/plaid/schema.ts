import type Database from 'better-sqlite3';

export function createPlaidSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plaid_items (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      environment TEXT NOT NULL,
      token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      cursor TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plaid_items_file ON plaid_items(file_id);
    CREATE TABLE IF NOT EXISTS plaid_records (
      item_id TEXT NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      account_id TEXT,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(item_id, kind, id)
    );
    CREATE INDEX IF NOT EXISTS plaid_records_account ON plaid_records(item_id, account_id, kind);
    CREATE TABLE IF NOT EXISTS plaid_link_sessions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      link_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      item_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS plaid_webhook_events (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      code TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);
}

export function dropPlaidSchema(db: Database.Database) {
  db.exec(
    'DROP TABLE IF EXISTS plaid_webhook_events; DROP TABLE IF EXISTS plaid_link_sessions; DROP TABLE IF EXISTS plaid_records; DROP TABLE IF EXISTS plaid_items;',
  );
}
