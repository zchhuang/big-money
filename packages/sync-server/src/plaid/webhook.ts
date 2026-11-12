import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';

import type { PlaidClient } from './client';
import type { PlaidStore } from './store';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Plaid webhook');
  }
  return Object.fromEntries(Object.entries(value));
}

export async function receivePlaidWebhook(
  client: PlaidClient,
  store: PlaidStore,
  jwt: string,
  body: Buffer,
  now = Date.now(),
) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid Plaid signature');
  const [headerPart, claimsPart, signaturePart] = parts;
  const header = object(
    JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')),
  );
  if (
    header.alg !== 'ES256' ||
    typeof header.kid !== 'string' ||
    header.kid.length > 200
  ) {
    throw new Error('Invalid Plaid signature');
  }
  const { data } = await client.webhookVerificationKeyGet({
    key_id: header.kid,
  });
  if (
    data.key.alg !== 'ES256' ||
    data.key.kty !== 'EC' ||
    data.key.crv !== 'P-256' ||
    data.key.expired_at != null
  ) {
    throw new Error('Invalid Plaid signing key');
  }
  const key = createPublicKey({ key: { ...data.key }, format: 'jwk' });
  if (
    !verify(
      'sha256',
      Buffer.from(`${headerPart}.${claimsPart}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signaturePart, 'base64url'),
    )
  ) {
    throw new Error('Invalid Plaid signature');
  }
  const claims = object(
    JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8')),
  );
  if (
    typeof claims.iat !== 'number' ||
    !Number.isFinite(claims.iat) ||
    now / 1000 - claims.iat > 300 ||
    claims.iat > now / 1000 + 30
  ) {
    throw new Error('Expired Plaid signature');
  }
  if (
    typeof claims.request_body_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(claims.request_body_sha256)
  ) {
    throw new Error('Invalid Plaid body hash');
  }
  const digest = createHash('sha256').update(body).digest();
  if (
    !timingSafeEqual(digest, Buffer.from(claims.request_body_sha256, 'hex'))
  ) {
    throw new Error('Invalid Plaid body hash');
  }
  const event = object(JSON.parse(body.toString('utf8')));
  if (
    typeof event.item_id !== 'string' ||
    typeof event.webhook_type !== 'string' ||
    typeof event.webhook_code !== 'string'
  ) {
    throw new Error('Invalid Plaid event');
  }
  // Hashing the exact signed body makes delivery retries idempotent. Store the
  // event durably; data refresh is explicit until a background worker is added.
  store.event(
    digest.toString('hex'),
    event.item_id,
    event.webhook_type,
    event.webhook_code,
    event,
  );
}
