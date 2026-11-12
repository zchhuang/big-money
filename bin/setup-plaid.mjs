import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
await mkdir(new URL('.local-data/', root), { recursive: true, mode: 0o700 });
const template = await readFile(new URL('.env.plaid.example', root), 'utf8');
try {
  await writeFile(
    new URL('.env.plaid', root),
    template
      .replace(
        'ACTUAL_DATA_DIR=.local-data',
        `ACTUAL_DATA_DIR=${JSON.stringify(fileURLToPath(new URL('.local-data', root)))}`,
      )
      .replace(
        'PLAID_ENCRYPTION_KEY=',
        `PLAID_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    `Created ${fileURLToPath(new URL('.env.plaid', root))}. Add Plaid Sandbox credentials and set PLAID_ENABLED=true.`,
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log(
    'Existing .env.plaid preserved. Its encryption key was not changed.',
  );
}
