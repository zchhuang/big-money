import { Products } from 'plaid/legacy';
import type { PlaidApi } from 'plaid/legacy';

import type { PlaidConfig } from './config';

export type SandboxClient = Pick<
  PlaidApi,
  | 'linkTokenCreate'
  | 'sandboxPublicTokenCreate'
  | 'itemPublicTokenExchange'
  | 'accountsGet'
  | 'transactionsSync'
  | 'itemRemove'
>;

// This diagnostic deliberately uses only a disposable Sandbox Item. It does not
// open an Actual budget, retain provider tokens, or initialize optional products.
export async function checkPlaidSandbox(
  client: SandboxClient,
  config: PlaidConfig,
) {
  if (config.environment !== 'sandbox') throw new Error('sandbox-only');
  await client.linkTokenCreate({
    client_name: 'Big Money',
    language: 'en',
    country_codes: config.countryCodes,
    user: { client_user_id: 'big-money-sandbox-check' },
    products: [Products.Transactions],
    hosted_link: {},
  });
  const created = await client.sandboxPublicTokenCreate({
    institution_id: 'ins_109508',
    initial_products: [Products.Transactions],
  });
  const exchanged = await client.itemPublicTokenExchange({
    public_token: created.data.public_token,
  });
  const access_token = exchanged.data.access_token;
  try {
    const accounts = await client.accountsGet({ access_token });
    const transactions = await client.transactionsSync({
      access_token,
      count: 1,
    });
    // An empty initial page is valid: Plaid can still be preparing history.
    return {
      accounts: accounts.data.accounts.length,
      initialTransactions: transactions.data.added.length,
      hasMore: transactions.data.has_more,
    };
  } finally {
    // Cleanup failure is a failed check as well. The caller reports safe codes,
    // never the SDK exception/config containing the access token or secret.
    await client.itemRemove({ access_token });
  }
}
