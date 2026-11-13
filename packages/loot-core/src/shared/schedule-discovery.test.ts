import { describe, expect, it } from 'vitest';

import type { DiscoverScheduleEntity } from '#types/models';

import { discoveryKey, readDismissedCandidates } from './schedule-discovery';

const candidate: DiscoverScheduleEntity = {
  id: 'suggestion',
  account: 'card',
  payee: 'merchant',
  amount: -100,
  date: { start: '2026-01-01', frequency: 'yearly' },
  _conditions: [],
};
describe('dismissed recurring candidates', () => {
  it('survives discovery IDs, price changes and advancing history', () => {
    expect(
      discoveryKey({
        ...candidate,
        id: 'new',
        amount: -110,
        date: { ...candidate.date, start: '2027-01-01' },
      }),
    ).toBe(discoveryKey(candidate));
  });
  it('keeps accounts, merchants, income and cadence separate', () => {
    for (const other of [
      { ...candidate, account: 'bank' },
      { ...candidate, payee: 'other' },
      { ...candidate, amount: 100 },
      {
        ...candidate,
        date: { ...candidate.date, frequency: 'monthly' as const },
      },
    ]) {
      expect(discoveryKey(other)).not.toBe(discoveryKey(candidate));
    }
  });
  it('handles missing or malformed saved preferences', () => {
    expect(readDismissedCandidates(undefined)).toEqual([]);
    expect(readDismissedCandidates('broken')).toEqual([]);
    expect(readDismissedCandidates('{}')).toEqual([]);
    expect(readDismissedCandidates('["saved",12,null]')).toEqual(['saved']);
  });
});
