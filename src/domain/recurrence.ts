// Recurrence engine for generation schedules.
//
// Product rules (03_WORKFLOWS_AND_RULES.md §E), implemented with Luxon:
// - once: the single chosen instant.
// - hours: elapsed time from the start instant (every N hours, N >= 1). DST does not affect spacing.
// - daily / weekdays / weekly: wall-clock time in the schedule's IANA timezone.
// - DST gap (nonexistent local time): shifted forward by the length of the gap, e.g. 02:30 -> 03:30.
// - DST overlap (repeated local time): runs once, at the earlier occurrence.
// - endDate is inclusive in the schedule timezone; maxRuns caps regular occurrences.

import { DateTime } from 'luxon';
import type { GenerationSchedule, Recurrence } from './types';

export type RecurrenceSpec = Pick<GenerationSchedule, 'startsAtUTC' | 'timezone' | 'recurrence' | 'endDate' | 'maxRuns'>;

const HARD_CAP = 5000;

/** Resolve a wall-clock local time in a zone, applying the gap/overlap rules. */
export function resolveLocal(
  zone: string,
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
): DateTime {
  const dt = DateTime.fromObject({ ...date, ...time, second: 0, millisecond: 0 }, { zone });
  // Overlap: if the same wall-clock reading also exists one hour earlier in absolute time, prefer the earlier one.
  const earlier = dt.minus({ hours: 1 });
  if (earlier.hour === dt.hour && earlier.minute === dt.minute && earlier.day === dt.day) return earlier;
  return dt;
}

function wallTime(spec: RecurrenceSpec) {
  const start = DateTime.fromISO(spec.startsAtUTC, { zone: 'utc' }).setZone(spec.timezone);
  return { start, hour: start.hour, minute: start.minute };
}

function dayMatches(rec: Recurrence, weekday: number, startWeekday: number): boolean {
  if (rec.kind === 'daily') return true;
  if (rec.kind === 'weekdays') return rec.weekdays.includes(weekday);
  if (rec.kind === 'weekly') return weekday === startWeekday;
  return false;
}

/**
 * Enumerate regular occurrences in chronological order (UTC ISO strings).
 * `afterExclusive` / `untilInclusive` bound the window; `limit` caps output.
 */
export function occurrences(
  spec: RecurrenceSpec,
  opts: { afterExclusive?: string | null; untilInclusive?: string | null; limit?: number },
): string[] {
  const limit = Math.min(opts.limit ?? HARD_CAP, HARD_CAP);
  const after = opts.afterExclusive ? DateTime.fromISO(opts.afterExclusive).toMillis() : -Infinity;
  const until = opts.untilInclusive ? DateTime.fromISO(opts.untilInclusive).toMillis() : Infinity;
  const endDate = spec.endDate;
  const maxRuns = spec.maxRuns ?? Infinity;
  const out: string[] = [];
  const { start, hour, minute } = wallTime(spec);
  if (!start.isValid) return out;

  const push = (dt: DateTime, index: number): 'stop' | 'continue' => {
    if (index >= maxRuns) return 'stop';
    if (endDate && dt.setZone(spec.timezone).toISODate()! > endDate) return 'stop';
    const ms = dt.toMillis();
    if (ms > until) return 'stop';
    if (ms > after) out.push(dt.toUTC().toISO()!);
    return out.length >= limit ? 'stop' : 'continue';
  };

  const rec = spec.recurrence;
  if (rec.kind === 'once') {
    push(start, 0);
    return out;
  }

  if (rec.kind === 'hours') {
    const step = Math.max(1, Math.floor(rec.everyHours)) * 3_600_000;
    // Jump close to the window start instead of iterating from the beginning.
    let index = 0;
    if (Number.isFinite(after) && after > start.toMillis()) index = Math.floor((after - start.toMillis()) / step);
    for (let guard = 0; guard < HARD_CAP * 4; guard++, index++) {
      const dt = DateTime.fromMillis(start.toMillis() + index * step, { zone: spec.timezone });
      if (push(dt, index) === 'stop') break;
    }
    return out;
  }

  // Calendar-based kinds: walk local dates from the start date.
  let day = start.startOf('day');
  let index = 0;
  for (let guard = 0; guard < 366 * 30; guard++) {
    if (dayMatches(rec, day.weekday, start.weekday)) {
      const dt = resolveLocal(spec.timezone, { year: day.year, month: day.month, day: day.day }, { hour, minute });
      if (dt.toMillis() >= start.toMillis()) {
        if (push(dt, index) === 'stop') break;
        index++;
      }
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

export function nextOccurrences(spec: RecurrenceSpec, afterISO: string, count: number): string[] {
  return occurrences(spec, { afterExclusive: afterISO, limit: count });
}

export function occurrenceKey(scheduleId: string, instantISO: string): string {
  return `${scheduleId}@${instantISO}`;
}

export function describeRecurrence(rec: Recurrence): string {
  switch (rec.kind) {
    case 'once':
      return 'Once';
    case 'hours':
      return rec.everyHours === 1 ? 'Every hour' : `Every ${rec.everyHours} hours`;
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'weekdays': {
      const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return [...rec.weekdays].sort().map((d) => names[d - 1]).join(', ');
    }
  }
}

export function isValidZone(zone: string): boolean {
  return DateTime.now().setZone(zone).isValid;
}

export function browserZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && isValidZone(z) ? z : 'UTC';
  } catch {
    return 'UTC';
  }
}

export const COMMON_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Istanbul',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function allZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = fn ? fn('timeZone') : [];
    return Array.from(new Set([...COMMON_ZONES, ...list]));
  } catch {
    return COMMON_ZONES;
  }
}
