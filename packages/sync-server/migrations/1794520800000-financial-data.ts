import { getAccountDb } from '../src/account-db';
import {
  createFinancialSchema,
  dropFinancialSchema,
} from '../src/financial/schema';

export async function up() {
  const db = getAccountDb();
  db.transaction(() => createFinancialSchema(db.db));
}
export async function down() {
  const db = getAccountDb();
  db.transaction(() => dropFinancialSchema(db.db));
}
