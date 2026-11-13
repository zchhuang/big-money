import { createHash, randomUUID } from 'node:crypto';

import type {
  Decision,
  LocalModel,
  ReviewCategory,
  ReviewEntry,
  ReviewLedger,
  ReviewPersistence,
  ReviewTransaction,
  Suggestion,
} from './types';

export function fingerprint(transaction: ReviewTransaction): string {
  // Category excluded: the journal compares it separately during apply/undo.
  return createHash('sha256')
    .update(
      JSON.stringify([
        transaction.id,
        transaction.account,
        transaction.payee,
        transaction.merchant,
        transaction.amount,
        transaction.date,
        transaction.importedId,
      ]),
    )
    .digest('hex');
}
function eligibleCategories(
  _transaction: ReviewTransaction,
  categories: ReviewCategory[],
) {
  // Refunds may use expense categories; reversals may use income categories.
  return categories;
}
export function createCategorizationReview(
  ledger: ReviewLedger,
  persistence: ReviewPersistence,
  model?: LocalModel,
  now = () => Date.now(),
) {
  const { state } = persistence;
  function entry(transaction: ReviewTransaction): ReviewEntry {
    const hash = fingerprint(transaction);
    let saved = state.entries.find(e => e.transactionId === transaction.id);
    if (!saved) {
      saved = {
        transactionId: transaction.id,
        fingerprint: hash,
        state: 'pending',
        attempts: 0,
      };
      state.entries.push(saved);
    }
    if (saved.fingerprint !== hash) {
      saved.fingerprint = hash;
      saved.state = 'pending';
      saved.attempts = 0;
      delete saved.suggestion;
      delete saved.retryAt;
    }
    return saved;
  }
  function learned(
    transaction: ReviewTransaction,
    categories: ReviewCategory[],
    transactions: ReviewTransaction[],
  ): Suggestion | undefined {
    if (!transaction.payee) return;
    const latest = new Map<string, Decision>();
    for (const decision of state.decisions) {
      latest.set(decision.transactionId, decision);
    }
    const examples = [...latest.values()].filter(
      d =>
        d.status === 'applied' &&
        transactions.some(
          t =>
            t.id === d.transactionId &&
            t.category === d.category &&
            fingerprint(t) === d.fingerprint,
        ) &&
        d.account === transaction.account &&
        d.payee === transaction.payee &&
        d.direction === (transaction.amount >= 0 ? 'income' : 'expense') &&
        categories.some(c => c.id === d.category),
    );
    const distinct = new Set(examples.map(d => d.category));
    if (examples.length < 2 || distinct.size !== 1) return;
    return {
      category: examples[0].category,
      confidence: 1,
      explanation: `Matches ${examples.length} approved corrections for this payee and account.`,
      source: 'correction',
    };
  }
  function validateSuggestion(
    saved: ReviewEntry,
    transaction: ReviewTransaction,
    categories: ReviewCategory[],
    transactions: ReviewTransaction[],
  ) {
    if (!saved.suggestion || saved.state === 'rejected') return;
    const correction =
      saved.suggestion.source === 'correction'
        ? learned(transaction, categories, transactions)
        : undefined;
    if (
      !categories.some(c => c.id === saved.suggestion?.category) ||
      (saved.suggestion.source === 'correction' &&
        correction?.category !== saved.suggestion.category)
    ) {
      saved.state = 'pending';
      delete saved.suggestion;
    } else if (correction) {
      saved.suggestion = correction;
    }
  }
  async function current(id: string) {
    const tx = (await ledger.transactions()).find(tx => tx.id === id);
    if (!tx?.eligible) {
      throw new Error(
        'Transaction is missing or not eligible for category review',
      );
    }
    return tx;
  }
  return {
    async queue() {
      const transactions = await ledger.transactions();
      const categories = await ledger.categories();
      const queue = transactions
        .filter(t => t.eligible && !t.category)
        .map(transaction => {
          const saved = entry(transaction);
          validateSuggestion(saved, transaction, categories, transactions);
          return { ...transaction, ...saved };
        });
      persistence.save();
      return queue;
    },
    async suggest({
      limit = 20,
      retry = false,
    }: { limit?: number; retry?: boolean } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Suggestion limit must be between 1 and 100');
      }
      const categories = await ledger.categories();
      const transactions = await ledger.transactions();
      const results: {
        transactionId: string;
        state: string;
        suggestion?: Suggestion;
      }[] = [];
      let attempts = 0;
      for (const tx of transactions.filter(t => t.eligible && !t.category)) {
        if (attempts >= limit) break;
        const saved = entry(tx);
        const allowed = eligibleCategories(tx, categories);
        validateSuggestion(saved, tx, allowed, transactions);
        if (saved.state === 'rejected' || saved.state === 'suggested') {
          continue;
        }
        const correction = learned(tx, allowed, transactions);
        if (
          !correction &&
          !retry &&
          (saved.state === 'abstained' ||
            (saved.state === 'retry' &&
              (saved.attempts >= 5 || (saved.retryAt ?? 0) > now())))
        ) {
          continue;
        }
        if (correction || model) attempts++;
        try {
          const proposal = correction ?? (await model?.suggest(tx, allowed));
          if (
            proposal &&
            (!allowed.some(c => c.id === proposal.category) ||
              !Number.isFinite(proposal.confidence) ||
              proposal.confidence < 0 ||
              proposal.confidence > 1 ||
              proposal.explanation.length > 240)
          ) {
            throw new Error('Invalid category suggestion');
          }
          if (proposal) {
            saved.suggestion = proposal;
            saved.state = 'suggested';
            delete saved.retryAt;
          } else {
            saved.state = model ? 'abstained' : 'pending';
          }
        } catch {
          // Model failures are represented as retryable queue entries, never
          // serialized errors that could echo transaction text or prompts.
          saved.state = 'retry';
          saved.attempts++;
          saved.retryAt =
            now() +
            Math.min(3_600_000, 30_000 * 2 ** Math.min(saved.attempts - 1, 7));
        }
        persistence.save();
        results.push({
          transactionId: tx.id,
          state: saved.state,
          suggestion: saved.suggestion,
        });
      }
      return results;
    },
    async approve(id: string, categoryId?: string) {
      if (
        state.decisions.some(
          d =>
            d.transactionId === id &&
            ['applying', 'undoing'].includes(d.status),
        )
      ) {
        throw new Error(
          'Recover the pending decision before approving another change',
        );
      }
      const tx = await current(id);
      const saved = entry(tx);
      if (tx.category) {
        throw new Error(
          'Transaction already categorized; explicit decisions are preserved',
        );
      }
      const categories = await ledger.categories();
      validateSuggestion(saved, tx, categories, await ledger.transactions());
      persistence.save();
      const category = categoryId ?? saved.suggestion?.category;
      if (
        !category ||
        !eligibleCategories(tx, categories).some(c => c.id === category)
      ) {
        throw new Error(
          'Choose an eligible category or generate a suggestion first',
        );
      }
      if (!categoryId && saved.state !== 'suggested') {
        throw new Error('No current suggestion to approve');
      }
      const decision: Decision = {
        id: randomUUID(),
        transactionId: id,
        account: tx.account,
        payee: tx.payee,
        direction: tx.amount >= 0 ? 'income' : 'expense',
        previous: tx.category,
        category,
        fingerprint: fingerprint(tx),
        suggestion:
          saved.suggestion?.category === category
            ? saved.suggestion
            : undefined,
        status: 'applying',
        createdAt: new Date(now()).toISOString(),
      };
      // Write-ahead journal survives a crash between the ledger update and
      // recording its success. A repair command resumes only guarded writes.
      state.decisions.push(decision);
      persistence.save();
      await ledger.setCategory(id, category);
      const updated = await current(id);
      if (updated.category !== category) {
        throw new Error(
          'Category update did not take effect; inspect the pending decision',
        );
      }
      decision.status = 'applied';
      persistence.save();
      return decision;
    },
    reject(id: string) {
      const saved = state.entries.find(e => e.transactionId === id);
      if (!saved || saved.state !== 'suggested') {
        throw new Error('No suggestion to reject');
      }
      saved.state = 'rejected';
      persistence.save();
      return { transactionId: id, state: saved.state };
    },
    async undo(decisionId: string) {
      const decision = state.decisions.find(d => d.id === decisionId);
      if (!decision || !['applied', 'undoing'].includes(decision.status)) {
        throw new Error('No applied decision to undo');
      }
      const tx = await current(decision.transactionId);
      if (
        fingerprint(tx) !== decision.fingerprint ||
        tx.category !== decision.category
      ) {
        throw new Error(
          'Transaction changed since approval; preserving its current values',
        );
      }
      decision.status = 'undoing';
      persistence.save();
      await ledger.setCategory(tx.id, decision.previous);
      if ((await current(tx.id)).category !== decision.previous) {
        throw new Error('Undo did not take effect');
      }
      decision.status = 'undone';
      const saved = entry(tx);
      saved.state = 'rejected';
      delete saved.suggestion;
      persistence.save();
      return decision;
    },
    async recover() {
      const results: { decisionId: string; state: string }[] = [];
      for (const decision of state.decisions.filter(d =>
        ['applying', 'undoing'].includes(d.status),
      )) {
        const tx = (await ledger.transactions()).find(
          transaction => transaction.id === decision.transactionId,
        );
        if (!tx?.eligible || fingerprint(tx) !== decision.fingerprint) {
          decision.status = 'conflicted';
          persistence.save();
          results.push({ decisionId: decision.id, state: 'conflict' });
          continue;
        }
        const target =
          decision.status === 'applying'
            ? decision.category
            : decision.previous;
        const previous =
          decision.status === 'applying'
            ? decision.previous
            : decision.category;
        if (tx.category !== target && tx.category !== previous) {
          decision.status = 'conflicted';
          persistence.save();
          results.push({ decisionId: decision.id, state: 'conflict' });
          continue;
        }
        if (target && !(await ledger.categories()).some(c => c.id === target)) {
          decision.status = 'conflicted';
          persistence.save();
          results.push({ decisionId: decision.id, state: 'conflict' });
          continue;
        }
        if (tx.category !== target) await ledger.setCategory(tx.id, target);
        if ((await current(tx.id)).category !== target) {
          throw new Error('Recovery did not take effect');
        }
        decision.status = decision.status === 'applying' ? 'applied' : 'undone';
        if (decision.status === 'undone') {
          const saved = entry(tx);
          saved.state = 'rejected';
          delete saved.suggestion;
        }
        persistence.save();
        results.push({ decisionId: decision.id, state: decision.status });
      }
      return results;
    },
    history() {
      return state.decisions;
    },
  };
}
