import { createHash, randomUUID } from 'node:crypto';

import type { LinkTokenCreateRequest } from 'plaid/legacy';

import type { PlaidClient } from './client';
import type { PlaidConfig } from './config';
import type { FinancialRecord, PlaidStore, RecordKind } from './store';

export function plaidErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return;
  }
  const response = error.response;
  if (
    typeof response !== 'object' ||
    response === null ||
    !('data' in response)
  ) {
    return;
  }
  const data = response.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'error_code' in data &&
    typeof data.error_code === 'string'
  ) {
    return data.error_code;
  }
}

export function createPlaidService(
  client: PlaidClient,
  store: PlaidStore,
  config: PlaidConfig,
) {
  // Serialize lifecycle operations per Item and Link completion per session.
  // SQLite revision checks also prevent stale commits across server processes.
  const pending = new Map<string, Promise<unknown>>();
  async function exclusive<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = pending.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    pending.set(key, current);
    try {
      return await current;
    } finally {
      if (pending.get(key) === current) pending.delete(key);
    }
  }
  function requireProduct(product: string) {
    if (
      ![...config.products, ...config.optionalProducts].some(p => p === product)
    ) {
      throw new Error('plaid-product-not-configured');
    }
  }
  async function refreshAccounts(fileId: string, itemId: string) {
    const row = store.item(fileId, itemId);
    const result = await client.accountsGet({
      access_token: store.token(fileId, itemId),
    });
    store.apply(
      fileId,
      itemId,
      row.revision,
      result.data.accounts.map(account => ({
        kind: 'account',
        id: account.account_id,
        accountId: account.account_id,
        data: account,
      })),
      [],
      undefined,
      ['account'],
    );
  }
  async function finish(fileId: string, userId: string, sessionId: string) {
    const session = store.session(sessionId, fileId, userId);
    if (session.status === 'complete' && session.item_id) {
      return { itemId: session.item_id };
    }
    let itemId = session.item_id;
    if (session.status === 'pending') {
      const result = await client.linkTokenGet({ link_token: session.token });
      const sessions = result.data.link_sessions ?? [];
      if (itemId) {
        if (!sessions.some(s => s.finished_at && !s.exit && !s.on_exit)) {
          throw new Error('plaid-link-pending');
        }
      } else {
        const tokens = sessions.flatMap(
          s =>
            s.results?.item_add_results?.map(r => r.public_token) ??
            (s.on_success ? [s.on_success.public_token] : []),
        );
        if (tokens.length !== 1) throw new Error('plaid-link-pending');
        const exchanged = await client.itemPublicTokenExchange({
          public_token: tokens[0],
        });
        itemId = exchanged.data.item_id;
        try {
          // Retain the credential before any further network request so an
          // accounts/metadata outage never loses the one-time exchange result.
          store.saveItem(fileId, itemId, exchanged.data.access_token, {
            item_id: itemId,
          });
          store.bindSession(sessionId, itemId);
        } catch (error) {
          await client.itemRemove({
            access_token: exchanged.data.access_token,
          });
          throw error;
        }
      }
    }
    if (!itemId) throw new Error('plaid-link-pending');
    const token = store.token(fileId, itemId);
    const metadata = await client.itemGet({ access_token: token });
    store.saveItem(fileId, itemId, token, metadata.data.item);
    await refreshAccounts(fileId, itemId);
    store.completeSession(sessionId, itemId);
    return { itemId };
  }
  return {
    async createLink(
      fileId: string,
      userId: string,
      itemId?: string,
      product?: string,
    ) {
      if (product) requireProduct(product);
      const products = product
        ? [...config.products, ...config.optionalProducts].filter(
            p => p === product,
          )
        : config.products;
      const optionalProducts = config.optionalProducts.filter(
        p => !products.includes(p),
      );
      const request: LinkTokenCreateRequest = {
        client_name: 'Big Money',
        language: 'en',
        country_codes: config.countryCodes,
        user: {
          client_user_id: createHash('sha256')
            .update(`${userId}:${fileId}`)
            .digest('hex'),
        },
        hosted_link: {},
        ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
        ...(config.webhook ? { webhook: config.webhook } : {}),
        ...(itemId
          ? { access_token: store.token(fileId, itemId) }
          : {
              products,
              optional_products: optionalProducts,
            }),
      };
      const { data } = await client.linkTokenCreate(request);
      const id = randomUUID();
      store.saveSession(
        id,
        fileId,
        userId,
        data.link_token,
        data.expiration,
        itemId,
      );
      return {
        sessionId: id,
        linkToken: data.link_token,
        url: data.hosted_link_url,
        expiration: data.expiration,
      };
    },
    complete(fileId: string, userId: string, sessionId: string) {
      return exclusive(`session:${sessionId}`, () =>
        finish(fileId, userId, sessionId),
      );
    },
    list(fileId: string) {
      return store.list(fileId);
    },
    records(
      fileId: string,
      itemId: string,
      kind: RecordKind,
      limit: number,
      offset: number,
    ) {
      return store.records(fileId, itemId, kind, limit, offset);
    },
    refreshAccounts(fileId: string, itemId: string) {
      return exclusive(itemId, () => refreshAccounts(fileId, itemId));
    },
    async syncTransactions(fileId: string, itemId: string) {
      requireProduct('transactions');
      return exclusive(itemId, async () => {
        const row = store.item(fileId, itemId);
        const accessToken = store.token(fileId, itemId);
        for (let attempt = 0; attempt < 3; attempt++) {
          let cursor = row.cursor ?? undefined;
          const records: FinancialRecord[] = [];
          const removed: string[] = [];
          try {
            for (let page = 0; ; page++) {
              if (page >= 1000) throw new Error('plaid-pagination-limit');
              const { data } = await client.transactionsSync({
                access_token: accessToken,
                cursor,
                count: 500,
              });
              for (const tx of [...data.added, ...data.modified]) {
                records.push({
                  kind: 'transaction',
                  id: tx.transaction_id,
                  accountId: tx.account_id,
                  data: tx,
                });
              }
              removed.push(...data.removed.map(tx => tx.transaction_id));
              cursor = data.next_cursor;
              if (!data.has_more) break;
            }
            store.apply(fileId, itemId, row.revision, records, removed, cursor);
            return { updated: records.length, removed: removed.length };
          } catch (error) {
            if (
              plaidErrorCode(error) !==
                'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
              attempt === 2
            ) {
              throw error;
            }
            // Restart the entire batch at the original persisted cursor.
          }
        }
        throw new Error('plaid-sync-failed');
      });
    },
    async snapshot(
      fileId: string,
      itemId: string,
      product: 'investments' | 'liabilities' | 'auth' | 'identity',
    ) {
      requireProduct(product);
      return exclusive(itemId, async () => {
        const row = store.item(fileId, itemId);
        const access_token = store.token(fileId, itemId);
        const records: FinancialRecord[] = [];
        const replace: RecordKind[] = [];
        if (product === 'investments') {
          const { data } = await client.investmentsHoldingsGet({
            access_token,
          });
          replace.push('holding', 'security');
          records.push(
            ...data.holdings.map(h => ({
              kind: 'holding' as const,
              id: `${h.account_id}:${h.security_id}`,
              accountId: h.account_id,
              data: h,
            })),
            ...data.securities.map(s => ({
              kind: 'security' as const,
              id: s.security_id,
              data: s,
            })),
          );
        } else if (product === 'liabilities') {
          const { data } = await client.liabilitiesGet({ access_token });
          replace.push('liability');
          for (const entries of Object.values(data.liabilities)) {
            if (Array.isArray(entries)) {
              records.push(
                ...entries.map(entry => ({
                  kind: 'liability' as const,
                  id: entry.account_id,
                  accountId: entry.account_id,
                  data: entry,
                })),
              );
            }
          }
        } else if (product === 'auth') {
          const { data } = await client.authGet({ access_token });
          replace.push('auth');
          records.push({ kind: 'auth', id: 'auth', data });
        } else {
          const { data } = await client.identityGet({ access_token });
          replace.push('identity');
          records.push({ kind: 'identity', id: 'identity', data });
        }
        store.apply(
          fileId,
          itemId,
          row.revision,
          records,
          [],
          undefined,
          replace,
        );
        return { updated: records.length };
      });
    },
    async investmentTransactions(
      fileId: string,
      itemId: string,
      startDate: string,
      endDate: string,
    ) {
      requireProduct('investments');
      return exclusive(itemId, async () => {
        const row = store.item(fileId, itemId);
        const access_token = store.token(fileId, itemId);
        const records: FinancialRecord[] = [];
        let offset = 0;
        for (let page = 0; ; page++) {
          if (page >= 1000) throw new Error('plaid-pagination-limit');
          const { data } = await client.investmentsTransactionsGet({
            access_token,
            start_date: startDate,
            end_date: endDate,
            options: { offset, count: 500 },
          });
          records.push(
            ...data.investment_transactions.map(tx => ({
              kind: 'investment_transaction' as const,
              id: tx.investment_transaction_id,
              accountId: tx.account_id,
              data: tx,
            })),
            ...data.securities.map(s => ({
              kind: 'security' as const,
              id: s.security_id,
              data: s,
            })),
          );
          offset += data.investment_transactions.length;
          if (offset >= data.total_investment_transactions) break;
          if (!data.investment_transactions.length) {
            throw new Error('plaid-pagination-stalled');
          }
        }
        store.apply(fileId, itemId, row.revision, records);
        return { updated: records.length };
      });
    },
    remove(fileId: string, itemId: string) {
      return exclusive(itemId, async () => {
        const access_token = store.token(fileId, itemId);
        await client.itemRemove({ access_token });
        store.remove(fileId, itemId);
      });
    },
  };
}
export type PlaidService = ReturnType<typeof createPlaidService>;
