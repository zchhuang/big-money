import { describe, expect, it } from 'vitest';

import { getNextDateAfter } from '#shared/schedules';

import { findLongPeriodSchedules, matchScheduleOccurrences } from './discovery';
import type { DiscoveryTransaction } from './discovery';

function transaction(
  date: string,
  overrides: Partial<DiscoveryTransaction> = {},
): DiscoveryTransaction {
  return {
    id: date,
    date,
    account: 'card',
    payee: 'merchant',
    amount: -12000,
    ...overrides,
  };
}

describe('recurring discovery evidence', () => {
  it('matches the correct merchant even when another merchant has the same amount', () => {
    const candidates = matchScheduleOccurrences(
      [
        {
          date: '2026-01-01',
          transactions: [
            transaction('2026-01-01', { payee: 'other', id: 'other' }),
            transaction('2026-01-01'),
          ],
        },
        { date: '2026-02-01', transactions: [transaction('2026-02-01')] },
      ],
      { start: '2026-01-01', frequency: 'monthly' },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence).toEqual({
      transactionCount: 2,
      firstDate: '2026-01-01',
      lastDate: '2026-02-01',
      minAmount: -12000,
      maxAmount: -12000,
    });
  });
  it('rejects reused observations, mixed accounts, refunds, empty payees and zero amounts', () => {
    for (const overrides of [
      { id: 'same' },
      { account: 'bank' },
      { amount: 12000 },
      { payee: null },
      { amount: 0 },
    ]) {
      const first = transaction('2026-01-01', { id: 'same' });
      const second = transaction('2026-02-01', overrides);
      expect(
        matchScheduleOccurrences(
          [
            { date: first.date, transactions: [first] },
            { date: second.date, transactions: [second] },
          ],
          { start: first.date, frequency: 'monthly' },
        ),
      ).toEqual([]);
    }
  });
  it('accepts amount variation within the existing schedule tolerance', () => {
    const candidates = matchScheduleOccurrences(
      [
        {
          date: '2026-01-01',
          transactions: [transaction('2026-01-01', { amount: -12500 })],
        },
        { date: '2026-02-01', transactions: [transaction('2026-02-01')] },
      ],
      { start: '2026-01-01', frequency: 'monthly' },
    );
    expect(candidates[0].exactAmount).toBe(false);
    expect(candidates[0].evidence.minAmount).toBe(-12500);
  });
});

describe('quarterly and annual recurrence', () => {
  it('finds an annual charge from two observations, including leap-year month ends', () => {
    const candidates = findLongPeriodSchedules([
      transaction('2024-02-29'),
      transaction('2025-02-28'),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].date.frequency).toBe('yearly');
    expect(candidates[0].evidence.transactionCount).toBe(2);
  });
  it('finds quarterly charges and tolerates weekend shifts', () => {
    const candidates = findLongPeriodSchedules(
      ['2026-01-02', '2026-04-01', '2026-07-01'].map(date => transaction(date)),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].date).toMatchObject({
      frequency: 'monthly',
      interval: 3,
    });
    expect(candidates[0].exactDate).toBe(false);
  });
  it('does not invent recurrence from duplicate imports on a single date', () => {
    expect(
      findLongPeriodSchedules([
        transaction('2026-01-01'),
        transaction('2026-01-01', { id: 'duplicate' }),
      ]),
    ).toEqual([]);
  });
  it('keeps independent accounts and income separate', () => {
    const history = ['2025-01-01', '2026-01-01'].flatMap(date => [
      transaction(date),
      transaction(date, { id: `bank-${date}`, account: 'bank' }),
      transaction(date, { id: `income-${date}`, amount: 12000 }),
    ]);
    expect(findLongPeriodSchedules(history)).toHaveLength(3);
  });
  it('rejects missing quarterly periods and unrelated amounts', () => {
    expect(
      findLongPeriodSchedules([
        transaction('2026-01-01'),
        transaction('2026-07-01'),
      ]),
    ).toEqual([]);
    expect(
      findLongPeriodSchedules([
        transaction('2025-01-01'),
        transaction('2026-01-01', { amount: -50000 }),
      ]),
    ).toEqual([]);
  });
  it('emits a real month-end quarterly rule that includes short months', () => {
    const candidates = findLongPeriodSchedules(
      ['2026-01-31', '2026-04-30', '2026-07-31'].map(date => transaction(date)),
    );
    expect(candidates).toHaveLength(1);
    const condition = { op: 'is', field: 'date', value: candidates[0].date };
    expect(candidates[0].date.patterns).toEqual([{ type: 'day', value: -1 }]);
    expect(getNextDateAfter(condition, '2026-01-31')).toBe('2026-04-30');
    expect(getNextDateAfter(condition, '2026-07-31')).toBe('2026-10-31');
  });
  it('marks leap-day annual evidence approximate when the emitted rule uses February 28', () => {
    const candidates = findLongPeriodSchedules([
      transaction('2023-02-28'),
      transaction('2024-02-29'),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].exactDate).toBe(false);
  });
  it('rejects annual or quarterly subsets of more frequent matching charges', () => {
    expect(
      findLongPeriodSchedules(
        ['01', '02', '03', '04', '05', '06', '07'].map(month =>
          transaction(`2026-${month}-01`),
        ),
      ),
    ).toEqual([]);
  });
  it('finds annual activity despite a later unrelated purchase at the same merchant', () => {
    const candidates = findLongPeriodSchedules([
      transaction('2025-01-01'),
      transaction('2026-01-01'),
      transaction('2026-02-10', { amount: -51000 }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].date.frequency).toBe('yearly');
    expect(candidates[0].evidence.lastDate).toBe('2026-01-01');
  });
  it('does not let a differently priced same-day purchase bypass monthly evidence', () => {
    expect(
      findLongPeriodSchedules([
        ...['01', '02', '03', '04', '05', '06', '07'].map(month =>
          transaction(`2026-${month}-01`),
        ),
        transaction('2026-07-01', { id: 'one-off', amount: -50000 }),
      ]),
    ).toEqual([]);
  });
});
