import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AAD binds each encrypted value to its budget, Item, and record identity.
// The master key lives outside SQLite and must be backed up separately.
export function createVault(key: Buffer) {
  if (key.length !== 32) {
    throw new Error('Plaid encryption requires a 32-byte key');
  }
  return {
    seal(value: unknown, context: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      return [
        'v1',
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        data.toString('base64'),
      ].join('.');
    },
    open(value: string, context: string): unknown {
      const [version, iv, tag, data] = value.split('.');
      if (version !== 'v1' || !iv || !tag || !data) {
        throw new Error('Invalid Plaid ciphertext');
      }
      const cipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64'),
      );
      cipher.setAAD(Buffer.from(context));
      cipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(data, 'base64')),
          cipher.final(),
        ]).toString('utf8'),
      );
    },
  };
}
