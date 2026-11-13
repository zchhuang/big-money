import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { ReviewPersistence, ReviewState } from './types';

// Callers hold the existing CLI budget lock for the entire read/modify/write.
// This sidecar stores IDs and decisions, not notes, email bodies or credentials.
export function openReviewState(
  directory: string,
  serverUrl: string,
  syncId: string,
): ReviewPersistence {
  const scope = createHash('sha256')
    .update(JSON.stringify([new URL(serverUrl).href, syncId]))
    .digest('hex');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, `categorization-${scope}.json`);
  let state: ReviewState = { version: 1, scope, entries: [], decisions: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8'));
    validateState(parsed, scope);
    state = parsed;
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error;
    }
  }
  return {
    state,
    save() {
      validateState(state, scope);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(state), {
          flag: 'wx',
          mode: 0o600,
        });
        renameSync(temporary, filename);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function suggestion(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.category === 'string' &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    typeof value.explanation === 'string' &&
    value.explanation.length <= 240 &&
    ['correction', 'local-model'].includes(String(value.source)) &&
    (value.model === undefined || typeof value.model === 'string') &&
    (value.promptVersion === undefined ||
      typeof value.promptVersion === 'string')
  );
}
function validateState(
  value: unknown,
  scope: string,
): asserts value is ReviewState {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.scope !== scope ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.decisions)
  ) {
    throw new Error(
      'Invalid categorization state; restore its backup rather than resetting feedback.',
    );
  }
  for (const entry of value.entries) {
    if (
      !record(entry) ||
      typeof entry.transactionId !== 'string' ||
      typeof entry.fingerprint !== 'string' ||
      !['pending', 'suggested', 'rejected', 'retry', 'abstained'].includes(
        String(entry.state),
      ) ||
      !Number.isInteger(entry.attempts) ||
      Number(entry.attempts) < 0 ||
      (entry.retryAt !== undefined &&
        (typeof entry.retryAt !== 'number' ||
          !Number.isFinite(entry.retryAt))) ||
      (entry.suggestion !== undefined && !suggestion(entry.suggestion))
    ) {
      throw new Error('Invalid categorization review entry');
    }
  }
  for (const decision of value.decisions) {
    if (
      !record(decision) ||
      typeof decision.id !== 'string' ||
      typeof decision.transactionId !== 'string' ||
      typeof decision.account !== 'string' ||
      !(decision.payee === null || typeof decision.payee === 'string') ||
      !['income', 'expense'].includes(String(decision.direction)) ||
      !(decision.previous === null || typeof decision.previous === 'string') ||
      typeof decision.category !== 'string' ||
      typeof decision.fingerprint !== 'string' ||
      !['applying', 'applied', 'undoing', 'undone', 'conflicted'].includes(
        String(decision.status),
      ) ||
      typeof decision.createdAt !== 'string' ||
      (decision.suggestion !== undefined && !suggestion(decision.suggestion))
    ) {
      throw new Error('Invalid categorization decision');
    }
  }
}
