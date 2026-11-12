import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

import Database from 'better-sqlite3';
import express from 'express';
import { Configuration, PlaidApi, Products } from 'plaid/legacy';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAccountDb } from '#account-db';

import { readPlaidConfig } from './config';
import type { PlaidConfig } from './config';
import { createPlaidRouter } from './router';
import { createPlaidSchema, dropPlaidSchema } from './schema';
import { createPlaidService } from './service';
import { createPlaidStore } from './store';
import { createVault } from './vault';
import { receivePlaidWebhook } from './webhook';

const key = randomBytes(32);
const env = {
  PLAID_ENABLED: 'true',
  PLAID_CLIENT_ID: 'test-id',
  PLAID_SECRET: 'test-secret',
  PLAID_ENCRYPTION_KEY: key.toString('base64'),
};
function configuration(): PlaidConfig {
  const config = readPlaidConfig(env);
  if (!config) throw new Error('Test Plaid config required');
  return config;
}
const fileId = '11111111-1111-4111-8111-111111111111';
const secondFileId = '22222222-2222-4222-8222-222222222222';
const itemId = 'item-test';
const accessToken = 'access-sandbox-secret';
const account = {
  account_id: 'account-1',
  name: 'Brokerage',
  type: 'investment',
  subtype: 'brokerage',
  balances: {
    current: 12.3456,
    available: null,
    limit: null,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
  },
  mask: '1234',
  official_name: null,
};
let db: Database.Database;
let store: ReturnType<typeof createPlaidStore>;
const calls: { path: string; body: Record<string, unknown> }[] = [];
let respond: (path: string, body: Record<string, unknown>) => unknown;
function client() {
  return new PlaidApi(
    new Configuration({
      basePath: 'https://sandbox.plaid.com',
      baseOptions: {
        adapter: async (config: {
          data?: string;
          url?: string;
          baseURL?: string;
        }) => {
          const body = JSON.parse(config.data ?? '{}');
          const path = new URL(config.url ?? '', config.baseURL).pathname;
          calls.push({ path, body });
          return {
            data: await respond(path, body),
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        },
      },
    }),
  );
}
function service() {
  return createPlaidService(client(), store, configuration());
}
function seed() {
  store.saveItem(fileId, itemId, accessToken, {
    item_id: itemId,
    consented_products: ['transactions', 'investments', 'liabilities'],
  });
}
function defaults(path: string): unknown {
  if (path === '/link/token/create') {
    return {
      link_token: 'link-sandbox-test',
      hosted_link_url: 'https://secure.plaid.com/link/test',
      expiration: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  if (path === '/link/token/get') {
    return {
      link_sessions: [
        {
          finished_at: new Date().toISOString(),
          results: {
            item_add_results: [{ public_token: 'public-sandbox-test' }],
          },
        },
      ],
    };
  }
  if (path === '/item/public_token/exchange') {
    return { access_token: accessToken, item_id: itemId };
  }
  if (path === '/item/get') {
    return {
      item: {
        item_id: itemId,
        institution_id: 'ins_1',
        consented_products: ['transactions', 'investments'],
      },
    };
  }
  if (path === '/accounts/get') return { accounts: [account] };
  if (path === '/item/remove') return {};
  throw new Error(`Unexpected test endpoint ${path}`);
}
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE files(id TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO files(id) VALUES (?), (?)').run(fileId, secondFileId);
  createPlaidSchema(db);
  store = createPlaidStore(db, key, 'sandbox');
  calls.length = 0;
  respond = path => defaults(path);
});
afterEach(() => db.close());

describe('Plaid configuration and encryption', () => {
  it('is opt-in, sandbox-first, and keeps optional products separate', () => {
    expect(readPlaidConfig({})).toBeNull();
    expect(configuration().environment).toBe('sandbox');
    expect(configuration().products).toEqual([Products.Transactions]);
    expect(configuration().optionalProducts).toEqual([
      Products.Investments,
      Products.Liabilities,
    ]);
    expect(() =>
      readPlaidConfig({ ...env, PLAID_ENV: 'development' }),
    ).toThrow();
    expect(() =>
      readPlaidConfig({ ...env, PLAID_ENCRYPTION_KEY: 'invalid' }),
    ).toThrow();
    expect(() =>
      readPlaidConfig({ ...env, PLAID_PRODUCTS: 'transfer' }),
    ).toThrow();
    expect(() =>
      readPlaidConfig({ ...env, PLAID_OPTIONAL_PRODUCTS: 'transactions' }),
    ).toThrow();
  });
  it('rejects tampering, wrong keys, and ciphertext moved to another record', () => {
    const vault = createVault(key);
    const encrypted = vault.seal({ secret: accessToken }, 'budget-a:item');
    expect(encrypted).not.toContain(accessToken);
    expect(vault.open(encrypted, 'budget-a:item')).toEqual({
      secret: accessToken,
    });
    expect(() => vault.open(encrypted, 'budget-b:item')).toThrow();
    expect(() =>
      createVault(randomBytes(32)).open(encrypted, 'budget-a:item'),
    ).toThrow();
    const parts = encrypted.split('.');
    parts[2] = Buffer.alloc(16).toString('base64');
    expect(() => vault.open(parts.join('.'), 'budget-a:item')).toThrow();
  });
});

describe('Link lifecycle and persistence', () => {
  it('completes Hosted Link, retains investment account detail, and never returns access tokens', async () => {
    const api = service();
    const link = await api.createLink(fileId, 'user-1');
    expect(link.url).toBe('https://secure.plaid.com/link/test');
    expect(calls[0].body).toMatchObject({
      products: ['transactions'],
      optional_products: ['investments', 'liabilities'],
    });
    expect(calls[0].body).not.toHaveProperty('account_filters');
    expect(await api.complete(fileId, 'user-1', link.sessionId)).toEqual({
      itemId,
    });
    expect(store.records(fileId, itemId, 'account', 100, 0)).toEqual([account]);
    expect(JSON.stringify(api.list(fileId))).not.toContain(accessToken);
    expect(
      JSON.stringify(db.prepare('SELECT * FROM plaid_items').all()),
    ).not.toContain(accessToken);
    expect(await api.complete(fileId, 'user-1', link.sessionId)).toEqual({
      itemId,
    });
    expect(
      calls.filter(c => c.path === '/item/public_token/exchange'),
    ).toHaveLength(1);
  });
  it('can connect investment-only institutions without requiring Transactions', async () => {
    await service().createLink(fileId, 'user-1', undefined, 'investments');
    expect(calls[0].body.products).toEqual(['investments']);
    expect(calls[0].body.optional_products).toEqual(['liabilities']);
  });
  it('keeps a completed Link exchange encrypted across a SQLite reopen', async () => {
    seed();
    const reopenedDb = new Database(db.serialize());
    try {
      const reopened = createPlaidStore(reopenedDb, key, 'sandbox');
      expect(reopened.token(fileId, itemId)).toBe(accessToken);
    } finally {
      reopenedDb.close();
    }
    expect(
      JSON.stringify(db.prepare('SELECT * FROM plaid_items').all()),
    ).not.toContain(accessToken);
  });
  it('scopes sessions to both user and budget', async () => {
    const api = service();
    const link = await api.createLink(fileId, 'user-1');
    await expect(
      api.complete(fileId, 'user-2', link.sessionId),
    ).rejects.toThrow('plaid-session-not-found');
    await expect(
      api.complete(secondFileId, 'user-1', link.sessionId),
    ).rejects.toThrow('plaid-session-not-found');
    expect(calls).toHaveLength(1);
  });
  it('waits for Link completion before exchanging', async () => {
    const api = service();
    const link = await api.createLink(fileId, 'user-1');
    respond = path =>
      path === '/link/token/get' ? { link_sessions: [] } : defaults(path);
    await expect(
      api.complete(fileId, 'user-1', link.sessionId),
    ).rejects.toThrow('plaid-link-pending');
    expect(calls.some(c => c.path === '/item/public_token/exchange')).toBe(
      false,
    );
  });
  it('recovers after an accounts outage without re-exchanging the one-time token', async () => {
    const api = service();
    const link = await api.createLink(fileId, 'user-1');
    respond = path => {
      if (path === '/accounts/get') throw new Error('offline');
      return defaults(path);
    };
    await expect(
      api.complete(fileId, 'user-1', link.sessionId),
    ).rejects.toThrow('offline');
    expect(store.token(fileId, itemId)).toBe(accessToken);
    respond = path => defaults(path);
    await api.complete(fileId, 'user-1', link.sessionId);
    expect(
      calls.filter(c => c.path === '/item/public_token/exchange'),
    ).toHaveLength(1);
  });
  it('reconnects an existing Item without creating another credential', async () => {
    seed();
    const api = service();
    const link = await api.createLink(fileId, 'user-1', itemId);
    expect(calls[0].body).toHaveProperty('access_token', accessToken);
    expect(calls[0].body).not.toHaveProperty('products');
    await api.complete(fileId, 'user-1', link.sessionId);
    expect(calls.some(c => c.path === '/item/public_token/exchange')).toBe(
      false,
    );
  });
  it('prevents cross-budget access and cleans up only after provider revocation succeeds', async () => {
    seed();
    const api = service();
    expect(() => store.token(secondFileId, itemId)).toThrow();
    expect(() =>
      createPlaidStore(db, key, 'production').token(fileId, itemId),
    ).toThrow();
    await expect(api.remove(secondFileId, itemId)).rejects.toThrow();
    expect(calls).toHaveLength(0);
    respond = () => {
      throw new Error('offline');
    };
    await expect(api.remove(fileId, itemId)).rejects.toThrow();
    expect(store.token(fileId, itemId)).toBe(accessToken);
    respond = path => defaults(path);
    await api.remove(fileId, itemId);
    expect(api.list(fileId)).toEqual([]);
  });
  it('creates and reverses the migration schema', () => {
    dropPlaidSchema(db);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'plaid_%'")
        .all(),
    ).toEqual([]);
    createPlaidSchema(db);
    seed();
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    expect(store.list(fileId)).toEqual([]);
  });
});

describe('transaction and product data', () => {
  it('restarts a mutated pagination batch and commits all pages with the cursor atomically', async () => {
    seed();
    let attempt = 0;
    respond = (_path, body) => {
      if (!body.cursor) {
        attempt++;
        return {
          added: [
            {
              transaction_id: attempt === 1 ? 'discarded' : 'kept',
              account_id: 'account-1',
              amount: 5,
            },
          ],
          modified: [],
          removed: [],
          has_more: true,
          next_cursor: 'page-2',
        };
      }
      if (attempt === 1) {
        throw Object.assign(new Error('Pagination mutated'), {
          response: {
            data: {
              error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
            },
          },
        });
      }
      return {
        added: [],
        modified: [
          { transaction_id: 'kept', account_id: 'account-1', amount: 7 },
        ],
        removed: [],
        has_more: false,
        next_cursor: 'done',
      };
    };
    await service().syncTransactions(fileId, itemId);
    expect(store.item(fileId, itemId).cursor).toBe('done');
    expect(store.records(fileId, itemId, 'transaction', 100, 0)).toEqual([
      { transaction_id: 'kept', account_id: 'account-1', amount: 7 },
    ]);
    expect(attempt).toBe(2);
  });
  it('keeps data and cursor unchanged when any page fails', async () => {
    seed();
    respond = (_path, body) => {
      if (body.cursor) throw new Error('offline');
      return {
        added: [{ transaction_id: 'partial' }],
        modified: [],
        removed: [],
        has_more: true,
        next_cursor: 'page-2',
      };
    };
    await expect(service().syncTransactions(fileId, itemId)).rejects.toThrow(
      'offline',
    );
    expect(store.item(fileId, itemId).cursor).toBeNull();
    expect(store.records(fileId, itemId, 'transaction', 100, 0)).toEqual([]);
  });
  it('applies deletions and rejects stale concurrent writes', async () => {
    seed();
    respond = () => ({
      added: [{ transaction_id: 'deleted', account_id: 'account-1' }],
      modified: [],
      removed: [],
      has_more: false,
      next_cursor: 'first',
    });
    const api = service();
    await api.syncTransactions(fileId, itemId);
    respond = () => ({
      added: [],
      modified: [],
      removed: [{ transaction_id: 'deleted' }],
      has_more: false,
      next_cursor: 'second',
    });
    await api.syncTransactions(fileId, itemId);
    expect(store.records(fileId, itemId, 'transaction', 100, 0)).toEqual([]);
    expect(() => store.apply(fileId, itemId, 0, [])).toThrow(
      'plaid-sync-conflict',
    );
  });
  it('replaces investment and loan snapshots without flattening product-specific fields', async () => {
    seed();
    respond = path =>
      path === '/investments/holdings/get'
        ? {
            holdings: [
              {
                account_id: 'account-1',
                security_id: 'security-1',
                quantity: 0.123456,
              },
            ],
            securities: [{ security_id: 'security-1', ticker_symbol: 'ABC' }],
          }
        : {
            liabilities: {
              mortgage: [
                { account_id: 'loan-1', interest_rate: { percentage: 4.5 } },
              ],
              credit: null,
              student: null,
            },
          };
    const api = service();
    await api.snapshot(fileId, itemId, 'investments');
    await api.snapshot(fileId, itemId, 'liabilities');
    expect(store.records(fileId, itemId, 'holding', 100, 0)).toMatchObject([
      { quantity: 0.123456 },
    ]);
    expect(store.records(fileId, itemId, 'liability', 100, 0)).toMatchObject([
      { interest_rate: { percentage: 4.5 } },
    ]);
    respond = () => ({ holdings: [], securities: [] });
    await api.snapshot(fileId, itemId, 'investments');
    expect(store.records(fileId, itemId, 'holding', 100, 0)).toEqual([]);
    expect(store.records(fileId, itemId, 'liability', 100, 0)).toHaveLength(1);
  });
  it('does not initialize products outside the configured allowlist', async () => {
    seed();
    await expect(service().snapshot(fileId, itemId, 'auth')).rejects.toThrow(
      'plaid-product-not-configured',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('investment activity', () => {
  it('paginates investment transactions and retains associated securities', async () => {
    seed();
    respond = (_path, body) => {
      const options = body.options;
      const offset =
        options && typeof options === 'object' && 'offset' in options
          ? options.offset
          : 0;
      return {
        investment_transactions: [
          {
            investment_transaction_id: offset ? 'sell' : 'buy',
            account_id: 'account-1',
            quantity: 0.002,
          },
        ],
        securities: [{ security_id: 's1' }],
        total_investment_transactions: 2,
      };
    };
    await service().investmentTransactions(
      fileId,
      itemId,
      '2026-01-01',
      '2026-11-11',
    );
    expect(
      store.records(fileId, itemId, 'investment_transaction', 100, 0),
    ).toHaveLength(2);
    expect(store.records(fileId, itemId, 'security', 100, 0)).toHaveLength(1);
    expect(calls[1].body.options).toMatchObject({ offset: 1 });
  });
});

describe('signed webhooks', () => {
  it('checks signature, exact body hash, age, and records duplicate delivery only once', async () => {
    seed();
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    respond = () => ({
      key: {
        ...publicKey.export({ format: 'jwk' }),
        alg: 'ES256',
        expired_at: null,
      },
    });
    const body = Buffer.from(
      JSON.stringify({
        item_id: itemId,
        webhook_type: 'ITEM',
        webhook_code: 'ERROR',
      }),
    );
    function jwt(age = 0) {
      const head = Buffer.from(
        JSON.stringify({ alg: 'ES256', kid: 'test-key' }),
      ).toString('base64url');
      const claims = Buffer.from(
        JSON.stringify({
          iat: Date.now() / 1000 - age,
          request_body_sha256: createHash('sha256').update(body).digest('hex'),
        }),
      ).toString('base64url');
      return `${head}.${claims}.${sign('sha256', Buffer.from(`${head}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    }
    await receivePlaidWebhook(client(), store, jwt(), body);
    await receivePlaidWebhook(client(), store, jwt(), body);
    expect(db.prepare('SELECT * FROM plaid_webhook_events').all()).toHaveLength(
      1,
    );
    expect(store.item(fileId, itemId).status).toBe('attention_required');
    await expect(
      receivePlaidWebhook(client(), store, jwt(), Buffer.from('{}')),
    ).rejects.toThrow('body hash');
    await expect(
      receivePlaidWebhook(client(), store, jwt(301), body),
    ).rejects.toThrow('Expired');
    await expect(
      receivePlaidWebhook(
        client(),
        store,
        jwt().slice(0, -8) + 'AAAAAAAA',
        body,
      ),
    ).rejects.toThrow('signature');
  });
});

describe('HTTP authorization', () => {
  function app() {
    const current = {
      config: configuration(),
      client: client(),
      store,
      service: service(),
    };
    return express()
      .use(express.json())
      .use(createPlaidRouter(() => current));
  }
  it('requires a session and a budget the user can access', async () => {
    await request(app()).get('/status').expect(401);
    await request(app())
      .get('/items')
      .set('x-actual-token', 'valid-token')
      .expect(400);
    await request(app())
      .get('/items')
      .set('x-actual-token', 'valid-token-user')
      .set('x-actual-file-id', fileId)
      .expect(403);
    expect(calls).toHaveLength(0);
  });
  it("does not expose another budget's Item even to an authenticated requester", async () => {
    const accountDb = getAccountDb();
    accountDb.mutate(
      'INSERT INTO files (id, owner, deleted) VALUES (?, ?, 0)',
      [secondFileId, 'genericAdmin'],
    );
    try {
      seed();
      const result = await request(app())
        .get(`/items/${itemId}/records/account`)
        .set('x-actual-token', 'valid-token')
        .set('x-actual-file-id', secondFileId)
        .expect(404);
      expect(result.body).not.toHaveProperty('token');
      expect(result.headers['cache-control']).toBe('no-store');
    } finally {
      accountDb.mutate('DELETE FROM files WHERE id = ?', [secondFileId]);
    }
  });
  it('sanitizes SDK errors that contain secret-bearing request configs', async () => {
    const accountDb = getAccountDb();
    accountDb.mutate(
      'INSERT INTO files (id, owner, deleted) VALUES (?, ?, 0)',
      [fileId, 'genericAdmin'],
    );
    try {
      seed();
      respond = () => {
        throw Object.assign(new Error('request contains private-secret'), {
          config: { secret: 'private-secret' },
          response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } },
        });
      };
      const result = await request(app())
        .post(`/items/${itemId}/accounts`)
        .set('x-actual-token', 'valid-token')
        .set('x-actual-file-id', fileId)
        .expect(502);
      expect(JSON.stringify(result.body)).not.toContain('private-secret');
      expect(result.body.code).toBe('ITEM_LOGIN_REQUIRED');
    } finally {
      accountDb.mutate('DELETE FROM files WHERE id = ?', [fileId]);
    }
  });
});
