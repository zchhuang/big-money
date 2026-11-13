import { differenceInCalendarDays, getDate, subMonths } from 'date-fns';

import { RSchedule } from '#server/util/rschedule';
import { dayFromDate, parseDate } from '#shared/months';
import { getApproxNumberThreshold } from '#shared/rules';
import { recurConfigToRSchedule } from '#shared/schedules';
import type { DiscoverScheduleEntity, RecurConfig } from '#types/models';

export type DiscoveryTransaction = {
  id: string;
  date: string;
  account: string;
  payee: string | null;
  amount: number;
};
type Occurrence = { date: string; transactions: DiscoveryTransaction[] };
export type DiscoveryCandidate = {
  rank: number;
  amount: number;
  account: string;
  payee: string;
  date: RecurConfig;
  exactDate: boolean;
  exactAmount: boolean;
  evidence: NonNullable<DiscoverScheduleEntity['evidence']>;
};

// Match identity and amount together: another merchant charging the same amount
// must neither hide a match nor become evidence for this recurring series.
export function matchScheduleOccurrences(
  occurrences: Occurrence[],
  config: RecurConfig,
): DiscoveryCandidate[] {
  const ordered = [...occurrences].reverse();
  const [base, ...rest] = ordered;
  if (!base || !rest.length) return [];
  const candidates: DiscoveryCandidate[] = [];
  for (const transaction of base.transactions) {
    if (!transaction.payee || transaction.amount === 0) continue;
    const threshold = getApproxNumberThreshold(transaction.amount);
    const used = new Set([transaction.id]);
    const matches = [transaction];
    let rank =
      1 /
      (Math.abs(
        differenceInCalendarDays(
          parseDate(base.date),
          parseDate(transaction.date),
        ),
      ) +
        1);
    for (const occurrence of rest) {
      const match = occurrence.transactions.find(
        other =>
          other.payee === transaction.payee &&
          other.account === transaction.account &&
          !used.has(other.id) &&
          Math.sign(other.amount) === Math.sign(transaction.amount) &&
          Math.abs(other.amount - transaction.amount) <= threshold,
      );
      if (!match) break;
      used.add(match.id);
      matches.push(match);
      rank +=
        1 /
        (Math.abs(
          differenceInCalendarDays(
            parseDate(occurrence.date),
            parseDate(match.date),
          ),
        ) +
          1);
    }
    if (matches.length !== ordered.length) continue;
    const dates = matches.map(t => t.date).sort();
    candidates.push({
      rank,
      amount: transaction.amount,
      account: transaction.account,
      payee: transaction.payee,
      date: config,
      exactDate: rank === ordered.length,
      exactAmount: matches.every(t => t.amount === transaction.amount),
      evidence: {
        transactionCount: matches.length,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        minAmount: Math.min(...matches.map(t => t.amount)),
        maxAmount: Math.max(...matches.map(t => t.amount)),
      },
    });
  }
  return candidates;
}

// Anchor long periods to actual merchant activity, rather than scanning every
// calendar day across years. Two annual observations are useful review evidence;
// quarterly candidates require three distinct observations.
export function findLongPeriodSchedules(
  transactions: DiscoveryTransaction[],
): DiscoveryCandidate[] {
  const groups = new Map<string, DiscoveryTransaction[]>();
  for (const transaction of transactions) {
    if (!transaction.payee || transaction.amount === 0) continue;
    const key = JSON.stringify([
      transaction.account,
      transaction.payee,
      Math.sign(transaction.amount),
    ]);
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }
  const result: DiscoveryCandidate[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.date.localeCompare(a.date));
    // A later one-off purchase must not hide an older recurring series.
    for (const latest of group) {
      for (const months of [3, 12]) {
        const count = months === 12 ? 2 : 3;
        const config: RecurConfig = {
          start: dayFromDate(
            subMonths(parseDate(latest.date), months * (count - 1)),
          ),
          frequency: months === 12 ? 'yearly' : 'monthly',
          ...(months === 3 ? { interval: 3 } : {}),
          ...(months === 3 && getDate(parseDate(latest.date)) > 28
            ? { patterns: [{ type: 'day', value: -1 }] }
            : {}),
        };
        // Use the actual recurrence engine's dates, including month-end and leap
        // behavior. Evidence must match the rule we will later create.
        const dates = new RSchedule({ rrules: recurConfigToRSchedule(config) })
          .occurrences({ take: count })
          .toArray()
          .map(occurrence => dayFromDate(occurrence.date));
        const occurrences = dates.map(date => ({
          date,
          transactions: group.filter(
            t =>
              Math.abs(
                differenceInCalendarDays(parseDate(t.date), parseDate(date)),
              ) <= 2,
          ),
        }));
        const threshold = getApproxNumberThreshold(latest.amount);
        const hasInterveningCharges = group.some(
          transaction =>
            transaction.date >= dates[0] &&
            transaction.date <= dates[dates.length - 1] &&
            Math.abs(transaction.amount - latest.amount) <= threshold &&
            !dates.some(
              date =>
                Math.abs(
                  differenceInCalendarDays(
                    parseDate(transaction.date),
                    parseDate(date),
                  ),
                ) <= 2,
            ),
        );
        // A long cadence cannot explain monthly/weekly matching charges between
        // its sample dates, even when both candidates would receive equal ranks.
        if (!hasInterveningCharges) {
          result.push(...matchScheduleOccurrences(occurrences, config));
        }
      }
    }
  }
  return result;
}
