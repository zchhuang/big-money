import type { DiscoverScheduleEntity } from '#types/models';

export function discoveryKey(schedule: DiscoverScheduleEntity): string {
  const amount =
    typeof schedule.amount === 'number'
      ? schedule.amount
      : schedule.amount.num1;
  return JSON.stringify([
    schedule.account,
    schedule.payee,
    Math.sign(amount),
    schedule.date.frequency,
    schedule.date.interval ?? 1,
    schedule.date.patterns ?? [],
  ]);
}

export function readDismissedCandidates(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}
