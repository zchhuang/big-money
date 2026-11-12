import { getAccountDb } from '../src/account-db';
import { createPlaidSchema, dropPlaidSchema } from '../src/plaid/schema';

export async function up() {
  const db = getAccountDb();
  db.transaction(() => createPlaidSchema(db.db));
}

export async function down() {
  const db = getAccountDb();
  db.transaction(() => dropPlaidSchema(db.db));
}
