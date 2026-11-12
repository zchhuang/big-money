import { CountryCode, Products } from 'plaid/legacy';

export type PlaidConfig = {
  environment: 'sandbox' | 'production';
  clientId: string;
  secret: string;
  encryptionKey: Buffer;
  products: Products[];
  optionalProducts: Products[];
  countryCodes: CountryCode[];
  redirectUri?: string;
  webhook?: string;
};

export function readPlaidConfig(env = process.env): PlaidConfig | null {
  if (env.PLAID_ENABLED !== 'true') return null;
  const environment = env.PLAID_ENV ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('PLAID_ENV must be sandbox or production');
  }
  const clientId = env.PLAID_CLIENT_ID;
  const secret = env.PLAID_SECRET;
  const encodedKey = env.PLAID_ENCRYPTION_KEY;
  if (!clientId || !secret || !encodedKey) {
    throw new Error('Plaid requires client ID, secret, and encryption key');
  }
  const encryptionKey = Buffer.from(encodedKey, 'base64');
  if (
    encryptionKey.length !== 32 ||
    encryptionKey.toString('base64') !== encodedKey
  ) {
    throw new Error(
      'PLAID_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }
  // These products share the Item lifecycle. Other Plaid product families need
  // their own consent/workflows; do not silently request or initialize them.
  const itemProducts = [
    Products.Transactions,
    Products.Investments,
    Products.Liabilities,
    Products.Auth,
    Products.Identity,
  ];
  function products(value: string): Products[] {
    return [
      ...new Set(
        value
          .split(',')
          .filter(Boolean)
          .map(name => {
            const product = itemProducts.find(p => p === name.trim());
            if (!product) throw new Error('Unsupported Plaid Link product');
            return product;
          }),
      ),
    ];
  }
  const required = products(env.PLAID_PRODUCTS ?? 'transactions');
  const optional = products(
    env.PLAID_OPTIONAL_PRODUCTS ?? 'investments,liabilities',
  );
  if (!required.length || optional.some(p => required.includes(p))) {
    throw new Error(
      'Plaid requires non-overlapping required and optional products',
    );
  }
  const countryCodes = (env.PLAID_COUNTRY_CODES ?? 'US')
    .split(',')
    .map(name => {
      const country = Object.values(CountryCode).find(c => c === name.trim());
      if (!country) throw new Error('Invalid Plaid country code');
      return country;
    });
  for (const value of [env.PLAID_REDIRECT_URI, env.PLAID_WEBHOOK_URL]) {
    if (value && new URL(value).protocol !== 'https:') {
      throw new Error('Plaid redirect and webhook URLs must use HTTPS');
    }
  }
  return {
    environment,
    clientId,
    secret,
    encryptionKey,
    products: required,
    optionalProducts: optional,
    countryCodes,
    redirectUri: env.PLAID_REDIRECT_URI,
    webhook: env.PLAID_WEBHOOK_URL,
  };
}
