import type Database from 'better-sqlite3';

import type { Vault } from './models';
import { createFinancialRepository } from './repository';
import { createFinancialService } from './service';

// Backward-compatible composition entry point for already-authorized budgets.
// Repository: persistence. Service: business rules. Projection: pure conversion.
export function createFinancialStore(
  db: Database.Database,
  vault: Vault,
  fileId: string,
) {
  if (typeof fileId !== 'string' || !fileId.trim() || fileId.length > 500) {
    throw new Error('invalid-financial-identifier');
  }
  return createFinancialService(createFinancialRepository(db, vault, fileId));
}
