import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Use the same dotenv syntax as Node's --env-file, rather than shell matching.
// Run before setup or chmod so a Production configuration is left untouched.
const file = process.argv[2];
try {
  if (!file) throw new Error('missing-config-path');
  if (existsSync(file)) {
    const environment = parseEnv(readFileSync(file, 'utf8')).PLAID_ENV;
    if (environment && environment !== 'sandbox') {
      console.error(
        'This file is not configured for Sandbox. Use a separate Sandbox checkout/configuration; no values were changed.',
      );
      process.exitCode = 1;
    }
  }
} catch {
  console.error(
    'Unable to inspect the Plaid configuration. No values were changed.',
  );
  process.exitCode = 1;
}
