import type Database from 'better-sqlite3';

import type { FinancialRecord, RecordKind } from './models';
import { createVault } from './vault';

export type { FinancialRecord, RecordKind } from './models';

export type ItemRow = {
  id: string;
  file_id: string;
  environment: string;
  token: string;
  status: string;
  cursor: string | null;
  revision: number;
  metadata: string;
  created_at: string;
  updated_at: string;
};
type LinkSession = {
  id: string;
  file_id: string;
  user_id: string;
  link_token: string;
  expires_at: string;
  item_id: string | null;
  status: string;
};

export function createPlaidStore(
  db: Database.Database,
  key: Buffer,
  environment: string,
) {
  const vault = createVault(key);
  function item(fileId: string, id: string): ItemRow {
    const row = db
      .prepare<unknown[], ItemRow>(
        'SELECT * FROM plaid_items WHERE id = ? AND file_id = ? AND environment = ?',
      )
      .get(id, fileId, environment);
    if (!row) throw new Error('plaid-item-not-found');
    return row;
  }
  function writeRecord(
    fileId: string,
    itemId: string,
    record: FinancialRecord,
  ) {
    db.prepare(`INSERT INTO plaid_records(item_id, kind, id, account_id, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id, kind, id) DO UPDATE SET account_id=excluded.account_id, payload=excluded.payload, updated_at=excluded.updated_at`).run(
      itemId,
      record.kind,
      record.id,
      record.accountId ?? null,
      vault.seal(
        record.data,
        `${fileId}:${itemId}:${record.kind}:${record.id}`,
      ),
      new Date().toISOString(),
    );
  }
  return {
    item,
    token(fileId: string, id: string): string {
      const token = vault.open(item(fileId, id).token, `${fileId}:${id}:token`);
      if (typeof token !== 'string') throw new Error('Invalid Plaid token');
      return token;
    },
    saveItem(fileId: string, id: string, token: string, metadata: unknown) {
      const existing = db
        .prepare<unknown[], { file_id: string; environment: string }>(
          'SELECT file_id, environment FROM plaid_items WHERE id = ?',
        )
        .get(id);
      if (
        existing &&
        (existing.file_id !== fileId || existing.environment !== environment)
      ) {
        throw new Error('plaid-item-conflict');
      }
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO plaid_items(id, file_id, environment, token, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET token=excluded.token, metadata=excluded.metadata, status='connected', updated_at=excluded.updated_at`).run(
        id,
        fileId,
        environment,
        vault.seal(token, `${fileId}:${id}:token`),
        vault.seal(metadata, `${fileId}:${id}:metadata`),
        now,
        now,
      );
    },
    list(fileId: string) {
      const rows = db
        .prepare<unknown[], ItemRow>(
          'SELECT * FROM plaid_items WHERE file_id = ? AND environment = ?',
        )
        .all(fileId, environment);
      return rows.map(row => ({
        id: row.id,
        status: row.status,
        environment: row.environment,
        metadata: vault.open(row.metadata, `${fileId}:${row.id}:metadata`),
        updatedAt: row.updated_at,
      }));
    },
    saveSession(
      id: string,
      fileId: string,
      userId: string,
      token: string,
      expiresAt: string,
      itemId?: string,
    ) {
      db.prepare('DELETE FROM plaid_link_sessions WHERE expires_at < ?').run(
        new Date().toISOString(),
      );
      db.prepare(
        'INSERT INTO plaid_link_sessions(id, file_id, user_id, link_token, expires_at, item_id) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        fileId,
        userId,
        vault.seal(token, `${fileId}:${id}:link`),
        expiresAt,
        itemId ?? null,
      );
    },
    session(id: string, fileId: string, userId: string) {
      const row = db
        .prepare<unknown[], LinkSession>(
          'SELECT * FROM plaid_link_sessions WHERE id = ? AND file_id = ? AND user_id = ?',
        )
        .get(id, fileId, userId);
      if (!row || row.expires_at <= new Date().toISOString()) {
        throw new Error('plaid-session-not-found');
      }
      const token = vault.open(row.link_token, `${fileId}:${id}:link`);
      if (typeof token !== 'string') throw new Error('Invalid Link token');
      return { ...row, token };
    },
    bindSession(id: string, itemId: string) {
      db.prepare(
        "UPDATE plaid_link_sessions SET item_id = ?, status = 'exchanged' WHERE id = ?",
      ).run(itemId, id);
    },
    completeSession(id: string, itemId: string) {
      db.prepare(
        "UPDATE plaid_link_sessions SET item_id = ?, status = 'complete' WHERE id = ?",
      ).run(itemId, id);
    },
    apply(
      fileId: string,
      itemId: string,
      revision: number,
      records: FinancialRecord[],
      removed: string[] = [],
      cursor?: string,
      replace: RecordKind[] = [],
    ) {
      db.transaction(() => {
        if (item(fileId, itemId).revision !== revision) {
          throw new Error('plaid-sync-conflict');
        }
        for (const kind of replace) {
          db.prepare(
            'DELETE FROM plaid_records WHERE item_id = ? AND kind = ?',
          ).run(itemId, kind);
        }
        for (const record of records) writeRecord(fileId, itemId, record);
        for (const id of removed) {
          db.prepare(
            "DELETE FROM plaid_records WHERE item_id = ? AND kind = 'transaction' AND id = ?",
          ).run(itemId, id);
        }
        db.prepare(
          'UPDATE plaid_items SET cursor=COALESCE(?, cursor), revision=revision+1, updated_at=? WHERE id=?',
        ).run(cursor ?? null, new Date().toISOString(), itemId);
      })();
    },
    records(
      fileId: string,
      itemId: string,
      kind: RecordKind,
      limit: number,
      offset: number,
    ) {
      item(fileId, itemId);
      const rows = db
        .prepare<unknown[], { id: string; payload: string }>(
          'SELECT id, payload FROM plaid_records WHERE item_id = ? AND kind = ? ORDER BY id LIMIT ? OFFSET ?',
        )
        .all(itemId, kind, limit, offset);
      return rows.map(row =>
        vault.open(row.payload, `${fileId}:${itemId}:${kind}:${row.id}`),
      );
    },
    remove(fileId: string, itemId: string) {
      item(fileId, itemId);
      db.transaction(() => {
        db.prepare('DELETE FROM plaid_records WHERE item_id = ?').run(itemId);
        db.prepare('DELETE FROM plaid_webhook_events WHERE item_id = ?').run(
          itemId,
        );
        db.prepare('DELETE FROM plaid_link_sessions WHERE item_id = ?').run(
          itemId,
        );
        db.prepare('DELETE FROM plaid_items WHERE id = ?').run(itemId);
      })();
    },
    event(
      id: string,
      itemId: string,
      type: string,
      code: string,
      data: unknown,
    ) {
      const row = db
        .prepare<unknown[], ItemRow>(
          'SELECT * FROM plaid_items WHERE id = ? AND environment = ?',
        )
        .get(itemId, environment);
      if (!row) return;
      db.transaction(() => {
        const result = db
          .prepare(
            'INSERT OR IGNORE INTO plaid_webhook_events(id, item_id, type, code, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            itemId,
            type,
            code,
            vault.seal(data, `${row.file_id}:${itemId}:event:${id}`),
            new Date().toISOString(),
          );
        if (result.changes && type === 'ITEM') {
          const status =
            code === 'LOGIN_REPAIRED' ? 'connected' : 'attention_required';
          db.prepare(
            'UPDATE plaid_items SET status=?, updated_at=? WHERE id=?',
          ).run(status, new Date().toISOString(), itemId);
        }
      })();
    },
  };
}
export type PlaidStore = ReturnType<typeof createPlaidStore>;
