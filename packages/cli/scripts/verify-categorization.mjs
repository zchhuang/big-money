import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as api from '@actual-app/api';

import { createActualReviewLedger } from '../src/categorization/actual-ledger.ts';
import { createCategorizationReview } from '../src/categorization/review.ts';
import { openReviewState } from '../src/categorization/storage.ts';

// Run after building @actual-app/cli. This uses an isolated copy of the committed
// test budget, with no server, Plaid credentials, personal budget, or local model.
// Parent cleanup runs after the child has drained Actual's asynchronous writes.
if (!process.env.BIG_MONEY_W3_SMOKE_DIRECTORY) {
  const temporary = await mkdtemp(join(tmpdir(), 'big-money-w3-smoke-'));
  let status;
  try {
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, BIG_MONEY_W3_SMOKE_DIRECTORY: temporary },
        stdio: 'inherit',
        timeout: 30_000,
      },
    );
    if (child.error) throw child.error;
    status = child.status ?? 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  process.exit(status);
}
const directory = process.env.BIG_MONEY_W3_SMOKE_DIRECTORY;
try {
  const budget = join(directory, 'fixture');
  await mkdir(budget);
  for (const filename of ['metadata.json', 'db.sqlite']) {
    await copyFile(
      new URL(
        `../../loot-core/src/mocks/files/default-budget-template/${filename}`,
        import.meta.url,
      ),
      join(budget, filename),
    );
  }
  await api.init({ dataDir: directory });
  await api.loadBudget('fixture');
  const account = await api.createAccount({ name: 'W3 fixture checking' }, 0);
  const group = await api.createCategoryGroup({ name: 'W3 fixture expenses' });
  const category = await api.createCategory({
    name: 'W3 fixture groceries',
    group_id: group,
  });
  const rows = [1, 2, 3].map(index => ({
    date: '2026-11-12',
    amount: -1250,
    payee_name: 'W3 Fixture Market',
    imported_id: `w3-fixture-${index}`,
  }));
  await api.importTransactions(account, rows);
  const ledger = createActualReviewLedger();
  function review() {
    return createCategorizationReview(
      ledger,
      openReviewState(
        join(directory, 'feedback'),
        'http://fixture.invalid',
        'fixture',
      ),
    );
  }
  const first = (await review().queue()).filter(tx => tx.account === account);
  assert.equal(first.length, 3);
  const decision = await review().approve(first[0].id, category);
  assert.equal(
    (await ledger.transactions()).find(tx => tx.id === first[0].id)?.category,
    category,
  );
  await review().undo(decision.id);
  assert.equal(
    (await ledger.transactions()).find(tx => tx.id === first[0].id)?.category,
    null,
  );
  await review().approve(first[0].id, category);
  await review().approve(first[1].id, category);
  const proposed = await review().suggest();
  assert.equal(
    proposed.find(tx => tx.transactionId === first[2].id)?.suggestion?.category,
    category,
  );
  // A provider refresh must preserve the explicitly approved categories.
  await api.importTransactions(account, rows);
  const after = await ledger.transactions();
  assert.equal(
    after.filter(
      tx => tx.account === account && tx.importedId?.startsWith('w3-fixture-'),
    ).length,
    3,
  );
  assert.equal(after.find(tx => tx.id === first[0].id)?.category, category);
  assert.equal(after.find(tx => tx.id === first[1].id)?.category, category);
  console.log(
    'Categorization smoke passed: real Actual ledger, approval, undo, saved learning, and idempotent reimport.',
  );
} finally {
  await api.shutdown();
}
