import { join } from 'node:path';

import type { Command } from 'commander';

import { getMetaDir } from '#cache';
import { createActualReviewLedger } from '#categorization/actual-ledger';
import { createLocalModel } from '#categorization/model';
import { createCategorizationReview } from '#categorization/review';
import { openReviewState } from '#categorization/storage';
import { withConnection } from '#connection';
import { printOutput } from '#output';

export function registerCategorizeCommand(program: Command) {
  const command = program
    .command('categorize')
    .description(
      'Review categories with saved corrections and optional local AI',
    );
  type Review = ReturnType<typeof createCategorizationReview>;
  async function run(
    action: (review: Review) => Promise<unknown> | unknown,
    useModel = false,
  ) {
    const opts = program.opts();
    if (opts.lock === false || process.env.ACTUAL_NO_LOCK === 'true') {
      throw new Error(
        'Categorization requires the budget lock; remove --no-lock',
      );
    }
    const result = await withConnection(
      opts,
      async config => {
        if (!config.syncId) throw new Error('A budget sync ID is required');
        if (config.noLock) {
          throw new Error('Categorization requires the budget lock');
        }
        const persistence = openReviewState(
          join(getMetaDir(config.dataDir, config.syncId), 'categorization'),
          config.serverUrl,
          config.syncId,
        );
        const model =
          useModel && process.env.ACTUAL_LOCAL_MODEL
            ? createLocalModel({
                model: process.env.ACTUAL_LOCAL_MODEL,
                url: process.env.ACTUAL_LOCAL_MODEL_URL,
              })
            : undefined;
        const review = createCategorizationReview(
          createActualReviewLedger(),
          persistence,
          model,
        );
        return action(review);
      },
      { mutates: true },
    );
    printOutput(result, opts.format);
  }
  command
    .command('queue')
    .description('List uncategorized transactions and review state')
    .action(() => run(review => review.queue()));
  command
    .command('suggest')
    .description('Suggest categories without changing transactions')
    .option('--limit <count>', 'Maximum transactions to consider (1–100)', '20')
    .option(
      '--retry',
      'Retry deferred/exhausted local-model requests now',
      false,
    )
    .action(options =>
      run(
        review =>
          review.suggest({
            limit: Number(options.limit),
            retry: options.retry === true,
          }),
        true,
      ),
    );
  command
    .command('approve <transaction-id>')
    .description('Apply one current suggestion or explicit correction')
    .option('--category <id>', 'Choose a category instead of the suggestion')
    .action((id: string, options) =>
      run(review =>
        review.approve(
          id,
          typeof options.category === 'string' ? options.category : undefined,
        ),
      ),
    );
  command
    .command('reject <transaction-id>')
    .description('Dismiss the suggestion for this version of a transaction')
    .action((id: string) => run(review => review.reject(id)));
  command
    .command('undo <decision-id>')
    .description('Undo a correction if the transaction has not changed')
    .action((id: string) => run(review => review.undo(id)));
  command
    .command('recover')
    .description(
      'Resume journaled changes after an interrupted approval or undo',
    )
    .action(() => run(review => review.recover()));
  command
    .command('history')
    .description('List correction decisions and their provenance')
    .action(() => run(review => review.history()));
}
