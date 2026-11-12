import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid/legacy';

import type { PlaidConfig } from './config';

export function createPlaidClient(config: PlaidConfig) {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.environment],
      baseOptions: {
        timeout: 30_000,
        headers: {
          'PLAID-CLIENT-ID': config.clientId,
          'PLAID-SECRET': config.secret,
          'Plaid-Version': '2020-09-14',
        },
      },
    }),
  );
}
// Only the operations used by this module, so its tests can supply a fake.
export type PlaidClient = Pick<
  PlaidApi,
  | 'linkTokenCreate'
  | 'linkTokenGet'
  | 'itemPublicTokenExchange'
  | 'itemGet'
  | 'itemRemove'
  | 'accountsGet'
  | 'transactionsSync'
  | 'investmentsHoldingsGet'
  | 'investmentsTransactionsGet'
  | 'liabilitiesGet'
  | 'authGet'
  | 'identityGet'
  | 'webhookVerificationKeyGet'
>;
