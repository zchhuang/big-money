import { Configuration, PlaidApi } from 'plaid/legacy';
import { describe, expect, it } from 'vitest';

import { readPlaidConfig } from './config';
import { checkPlaidSandbox } from './sandbox';

function setup(failure?: string) {
  const config = readPlaidConfig({
    PLAID_ENABLED: 'true',
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_ID: 'test-client',
    PLAID_SECRET: 'test-secret',
    PLAID_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  });
  if (!config) throw new Error('Test config required');
  const calls: string[] = [];
  const client = new PlaidApi(
    new Configuration({
      basePath: 'https://sandbox.plaid.com',
      baseOptions: {
        adapter: async (options: { url: string; data?: string }) => {
          const path = new URL(options.url, 'https://sandbox.plaid.com')
            .pathname;
          calls.push(path);
          if (path === failure) throw new Error('test-outage');
          const data = {
            '/link/token/create': { link_token: 'link-secret' },
            '/sandbox/public_token/create': { public_token: 'public-secret' },
            '/item/public_token/exchange': { access_token: 'access-secret' },
            '/accounts/get': { accounts: [{ account_id: 'test-account' }] },
            '/transactions/sync': { added: [], has_more: false },
            '/item/remove': {},
          }[path];
          return {
            data,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: options,
          };
        },
      },
    }),
  );
  return { client, config, calls };
}
describe('Sandbox setup diagnostic', () => {
  it('creates and removes a disposable Item and returns no credentials', async () => {
    const { client, config, calls } = setup();
    const result = await checkPlaidSandbox(client, config);
    expect(result).toEqual({
      accounts: 1,
      initialTransactions: 0,
      hasMore: false,
    });
    expect(calls).toEqual([
      '/link/token/create',
      '/sandbox/public_token/create',
      '/item/public_token/exchange',
      '/accounts/get',
      '/transactions/sync',
      '/item/remove',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('refuses Production before making any network call', async () => {
    const { client, config, calls } = setup();
    await expect(
      checkPlaidSandbox(client, { ...config, environment: 'production' }),
    ).rejects.toThrow('sandbox-only');
    expect(calls).toEqual([]);
  });
  it.each(['/accounts/get', '/transactions/sync'])(
    'revokes the temporary Item when %s fails',
    async path => {
      const { client, config, calls } = setup(path);
      await expect(checkPlaidSandbox(client, config)).rejects.toThrow(
        'test-outage',
      );
      expect(calls.at(-1)).toBe('/item/remove');
    },
  );
  it('reports cleanup failure instead of claiming validation completed', async () => {
    const { client, config } = setup('/item/remove');
    await expect(checkPlaidSandbox(client, config)).rejects.toThrow(
      'test-outage',
    );
  });
  it('does not try cleanup before a credential has been exchanged', async () => {
    const { client, config, calls } = setup('/item/public_token/exchange');
    await expect(checkPlaidSandbox(client, config)).rejects.toThrow(
      'test-outage',
    );
    expect(calls).not.toContain('/item/remove');
  });
});
