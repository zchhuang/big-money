import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { loadRules } from '#server/transactions/transaction-rules';

import { findSchedules } from './find-schedules';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

describe('schedule discovery against the budget ledger', () => {
  it('discovers annual and quarterly activity while excluding transfers and keeping accounts separate', async () => {
    const card = await db.insertAccount({
      name: 'Card',
      offbudget: 0,
      closed: 0,
    });
    const bank = await db.insertAccount({
      name: 'Bank',
      offbudget: 0,
      closed: 0,
    });
    const annual = await db.insertPayee({ name: 'Annual service' });
    const quarterly = await db.insertPayee({ name: 'Quarterly bill' });
    const transfer = await db.insertPayee({
      name: 'Transfer',
      transfer_acct: bank,
    });
    await loadMappings();
    for (const account of [card, bank]) {
      for (const date of ['2025-01-01', '2026-01-01']) {
        await db.insertTransaction({
          account,
          date,
          payee: annual,
          amount: -9900,
        });
      }
    }
    for (const date of ['2025-07-01', '2025-10-01', '2026-01-01']) {
      await db.insertTransaction({
        account: card,
        date,
        payee: quarterly,
        amount: -5000,
      });
      await db.insertTransaction({
        account: card,
        date,
        payee: transfer,
        amount: -8000,
      });
    }
    const schedules = await findSchedules();
    expect(schedules.filter(s => s.payee === annual)).toHaveLength(2);
    expect(schedules.find(s => s.payee === quarterly)?.date).toMatchObject({
      frequency: 'monthly',
      interval: 3,
    });
    expect(schedules.some(s => s.payee === transfer)).toBe(false);
    expect(schedules.every(s => (s.evidence?.transactionCount ?? 0) >= 2)).toBe(
      true,
    );
  });
  it('keeps monthly activity monthly after more than six months of history', async () => {
    const account = await db.insertAccount({
      name: 'Card',
      offbudget: 0,
      closed: 0,
    });
    const payee = await db.insertPayee({ name: 'Monthly service' });
    await loadMappings();
    for (const month of ['01', '02', '03', '04', '05', '06', '07']) {
      await db.insertTransaction({
        account,
        payee,
        date: `2026-${month}-01`,
        amount: -9900,
      });
    }
    const suggestions = await findSchedules();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].date.frequency).toBe('monthly');
    expect(suggestions[0].date.interval ?? 1).toBe(1);
  });
});
