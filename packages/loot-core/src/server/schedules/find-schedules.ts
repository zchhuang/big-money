// @ts-strict-ignore
import * as d from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { fromDateRepr } from '#server/models';
import { conditionsToAQL } from '#server/transactions/transaction-rules';
import { RSchedule } from '#server/util/rschedule';
import { dayFromDate, parseDate } from '#shared/months';
import { q } from '#shared/query';
import { recurConfigToRSchedule } from '#shared/schedules';
import { groupBy } from '#shared/util';
import type { DiscoverScheduleEntity } from '#types/models';

import { findLongPeriodSchedules, matchScheduleOccurrences } from './discovery';

function takeDates(config) {
  const schedule = new RSchedule({ rrules: recurConfigToRSchedule(config) });
  return schedule
    .occurrences({ take: 3 })
    .toArray()
    .map(d => d.date);
}

async function getTransactions(date, account) {
  const { data } = await aqlQuery(
    q('transactions')
      .filter({
        account,
        schedule: null,
        // Don't match transfers
        'payee.transfer_acct': null,
        $and: [
          { date: { $gte: d.subDays(date, 2) } },
          { date: { $lte: d.addDays(date, 2) } },
        ],
      })
      .select('*')
      .options({ splits: 'none' }),
  );
  return data;
}

async function schedulesForPattern(baseStart, numDays, baseConfig, accountId) {
  let schedules = [];

  for (let i = 0; i < numDays; i++) {
    const start = d.addDays(baseStart, i);
    let config;
    if (typeof baseConfig === 'function') {
      config = baseConfig(start);

      if (config === false) {
        // Skip this one
        continue;
      }
    } else {
      config = { ...baseConfig, start };
    }

    // Our recur config expects a day string, not a native date format
    config.start = dayFromDate(config.start);

    const data = [];
    const dates = takeDates(config);
    for (const date of dates) {
      data.push({
        date: dayFromDate(date),
        transactions: await getTransactions(date, accountId),
      });
    }

    schedules = schedules.concat(matchScheduleOccurrences(data, config));
  }
  return schedules;
}

async function weekly(startDate, accountId) {
  return schedulesForPattern(
    d.subWeeks(parseDate(startDate), 4),
    7 * 2,
    { frequency: 'weekly' },
    accountId,
  );
}

async function every2weeks(startDate, accountId) {
  return schedulesForPattern(
    // 6 weeks would cover 3 instances, but we also scan an addition
    // week back
    d.subWeeks(parseDate(startDate), 7),
    7 * 2,
    { frequency: 'weekly', interval: 2 },
    accountId,
  );
}

async function monthly(startDate, accountId) {
  return schedulesForPattern(
    d.subMonths(parseDate(startDate), 4),
    31 * 2,
    start => {
      // 28 is the max number of days that all months are guaranteed
      // to have. We don't want to go any higher than that because
      // we'll end up skipping months that don't have that day.
      // The use cases of end of month days will be covered with the
      // `monthlyLastDay` pattern;
      if (d.getDate(start) > 28) {
        return false;
      }
      return { start, frequency: 'monthly' };
    },
    accountId,
  );
}

async function monthlyLastDay(startDate, accountId) {
  // We do two separate calls because this pattern doesn't fit into
  // how `schedulesForPattern` works
  const s1 = await schedulesForPattern(
    d.subMonths(parseDate(startDate), 3),
    1,
    { frequency: 'monthly', patterns: [{ type: 'day', value: -1 }] },
    accountId,
  );

  const s2 = await schedulesForPattern(
    d.subMonths(parseDate(startDate), 4),
    1,
    { frequency: 'monthly', patterns: [{ type: 'day', value: -1 }] },
    accountId,
  );

  return s1.concat(s2);
}

async function monthly1stor3rd(startDate, accountId) {
  return schedulesForPattern(
    d.subWeeks(parseDate(startDate), 8),
    14,
    start => {
      const day = d.format(new Date(), 'iiii');
      const dayValue = day.slice(0, 2).toUpperCase();

      return {
        start,
        frequency: 'monthly',
        patterns: [
          { type: dayValue, value: 1 },
          { type: dayValue, value: 3 },
        ],
      };
    },
    accountId,
  );
}

async function monthly2ndor4th(startDate, accountId) {
  return schedulesForPattern(
    d.subMonths(parseDate(startDate), 8),
    14,
    start => {
      const day = d.format(new Date(), 'iiii');
      const dayValue = day.slice(0, 2).toUpperCase();

      return {
        start,
        frequency: 'monthly',
        patterns: [
          { type: dayValue, value: 2 },
          { type: dayValue, value: 4 },
        ],
      };
    },
    accountId,
  );
}

async function findStartDate(schedule) {
  const conditions = schedule._conditions;
  const dateCond = conditions.find(c => c.field === 'date');
  let currentConfig = dateCond.value;

  while (true) {
    const prevConfig = currentConfig;
    currentConfig = { ...prevConfig };

    switch (currentConfig.frequency) {
      case 'weekly':
        currentConfig.start = dayFromDate(
          d.subWeeks(
            parseDate(currentConfig.start),
            currentConfig.interval || 1,
          ),
        );

        break;
      case 'monthly':
        currentConfig.start = dayFromDate(
          d.subMonths(
            parseDate(currentConfig.start),
            currentConfig.interval || 1,
          ),
        );
        break;
      case 'yearly':
        currentConfig.start = dayFromDate(
          d.subYears(
            parseDate(currentConfig.start),
            currentConfig.interval || 1,
          ),
        );
        break;
      default:
        throw new Error('findStartDate: invalid frequency');
    }

    const newConditions = conditions.map(c =>
      c.field === 'date' ? { ...c, value: currentConfig } : c,
    );

    const { filters, errors } = conditionsToAQL(newConditions, {
      recurDateBounds: 1,
    });
    if (errors.length > 0) {
      // Somehow we generated an invalid config. Abort the whole
      // process and don't change the date at all
      currentConfig = null;
      break;
    }

    const { data } = await aqlQuery(
      q('transactions').filter({ $and: filters }).select('*'),
    );

    if (data.length === 0) {
      // No data, revert back to the last valid value and stop
      currentConfig = prevConfig;
      break;
    }
  }

  if (currentConfig) {
    return {
      ...schedule,
      date: currentConfig,
      _conditions: conditions.map(c =>
        c.field === 'date' ? { ...c, value: currentConfig } : c,
      ),
    };
  }
  return schedule;
}

export async function findSchedules(): Promise<DiscoverScheduleEntity[]> {
  // Patterns to look for:
  // * Weekly
  // * Every two weeks
  // * Monthly on day X
  // * Monthly on every 1st or 3rd day
  // * Monthly on every 2nd or 4th day
  //
  // Search for them approx (+- 2 days) but track which transactions
  // and find the best one...

  const { data: accounts } = await aqlQuery(
    q('accounts').filter({ closed: false }).select('*'),
  );

  let allSchedules = [];

  for (const account of accounts) {
    // Find latest transaction-ish to start with
    const latestTrans = await db.first<Pick<db.DbViewTransaction, 'date'>>(
      'SELECT date FROM v_transactions WHERE account = ? AND parent_id IS NULL ORDER BY date DESC LIMIT 1',
      [account.id],
    );

    if (latestTrans) {
      const latestDate = fromDateRepr(latestTrans.date);
      const { data: history } = await aqlQuery(
        q('transactions')
          .filter({
            account: account.id,
            schedule: null,
            'payee.transfer_acct': null,
            date: { $lte: latestDate },
          })
          .select('*')
          .options({ splits: 'none' }),
      );
      allSchedules = allSchedules.concat(
        findLongPeriodSchedules(history),
        await weekly(latestDate, account.id),
        await every2weeks(latestDate, account.id),
        await monthly(latestDate, account.id),
        await monthlyLastDay(latestDate, account.id),
        await monthly1stor3rd(latestDate, account.id),
        await monthly2ndor4th(latestDate, account.id),
      );
    }
  }

  const grouped = allSchedules.map(s => ({
    ...s,
    group: JSON.stringify([s.account, s.payee, Math.sign(s.amount)]),
  }));
  const schedules = [...groupBy(grouped, 'group').entries()].map(
    ([, schedules]) => {
      schedules.sort(
        (s1, s2) =>
          s2.evidence.lastDate.localeCompare(s1.evidence.lastDate) ||
          s2.rank - s1.rank,
      );
      const winner = schedules[0];

      // Convert to schedule and return it
      return {
        id: uuidv4(),
        account: winner.account,
        payee: winner.payee,
        date: winner.date,
        amount: winner.amount,
        evidence: winner.evidence,
        _conditions: [
          { op: 'is', field: 'account', value: winner.account },
          { op: 'is', field: 'payee', value: winner.payee },
          {
            op: winner.exactDate ? 'is' : 'isapprox',
            field: 'date',
            value: winner.date,
          },
          {
            op: winner.exactAmount ? 'is' : 'isapprox',
            field: 'amount',
            value: winner.amount,
          },
        ],
      };
    },
  );

  const finalized: Awaited<ReturnType<typeof findStartDate>> = [];
  for (const schedule of schedules) {
    finalized.push(await findStartDate(schedule));
  }
  return finalized;
}
