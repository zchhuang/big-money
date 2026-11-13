import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(
  new URL('./check-plaid-environment.mts', import.meta.url),
);
for (const declaration of [
  'PLAID_ENV=production',
  'PLAID_ENV = production',
  'export PLAID_ENV=production',
  'PLAID_ENV=production # live',
  'PLAID_ENV="production"',
]) {
  await test(`protects ${declaration}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'plaid-env-test-'));
    try {
      const file = join(directory, '.env.plaid');
      const contents = `${declaration}\nPLAID_SECRET=dummy-private-value\n`;
      writeFileSync(file, contents, { mode: 0o600 });
      const result = spawnSync(process.execPath, [checker, file], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.equal(readFileSync(file, 'utf8'), contents);
      assert.ok(
        !`${result.stdout}${result.stderr}`.includes('dummy-private-value'),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
await test('accepts a fresh setup or a valid Sandbox configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plaid-env-test-'));
  try {
    const file = join(directory, '.env.plaid');
    assert.equal(spawnSync(process.execPath, [checker, file]).status, 0);
    writeFileSync(file, 'export PLAID_ENV = "sandbox" # testing\n');
    assert.equal(spawnSync(process.execPath, [checker, file]).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
await test('checks the environment before any setup writes', () => {
  const wizard = readFileSync(
    new URL('./setup-plaid-sandbox.sh', import.meta.url),
    'utf8',
  );
  const guard = wizard.indexOf('node bin/check-plaid-environment.mts');
  assert.ok(guard > 0);
  assert.ok(guard < wizard.indexOf('node bin/setup-plaid.mjs'));
  assert.ok(guard < wizard.indexOf('chmod 600'));
});
