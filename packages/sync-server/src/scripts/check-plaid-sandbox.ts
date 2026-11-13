import { createPlaidClient } from '#plaid/client';
import { readPlaidConfig } from '#plaid/config';
import { checkPlaidSandbox } from '#plaid/sandbox';
import { plaidErrorCode } from '#plaid/service';

try {
  const config = readPlaidConfig();
  if (!config) {
    console.error(
      'Plaid is disabled. Run the setup wizard or set PLAID_ENABLED=true in .env.plaid.',
    );
    process.exitCode = 1;
  } else if (config.environment !== 'sandbox') {
    console.error(
      'This diagnostic only runs in Sandbox. Production was not contacted.',
    );
    process.exitCode = 1;
  } else {
    const result = await checkPlaidSandbox(createPlaidClient(config), config);
    console.log(
      `Sandbox verified: Link token creation, token exchange, ${result.accounts} account(s), and transaction retrieval succeeded.`,
    );
    console.log(
      `Initial page: ${result.initialTransactions} transaction(s). Empty history may still be preparing.`,
    );
    console.log(
      'Temporary Sandbox Item removed. No financial data or provider tokens were saved.',
    );
    console.log(
      'This checks API credentials; interactive Hosted Link and real institution coverage still need validation.',
    );
  }
} catch (error) {
  const code = plaidErrorCode(error);
  const safeCode = code && /^[A-Z0-9_]{1,100}$/.test(code) ? ` (${code})` : '';
  console.error(
    `Sandbox check failed${safeCode}. Verify your Sandbox keys, Transactions access, and network connection.`,
  );
  console.error(
    'If an Item was created, cleanup was attempted. Check the Plaid Dashboard for temporary Items if cleanup failed.',
  );
  process.exitCode = 1;
}
