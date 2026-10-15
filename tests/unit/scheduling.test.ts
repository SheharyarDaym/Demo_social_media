import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { occurrences, nextOccurrences, occurrenceKey, resolveLocal } from '../../src/domain/recurrence';
import { dueOccurrences, findMissedRuns, markHandled, runOccurrence, skipOccurrences } from '../../src/domain/generationRuns';
import { buildSeed } from '../../src/fixtures/seed';
import type { Ctx } from '../../src/domain/ops';
import type { GenerationSchedule } from '../../src/domain/types';
import { claim, _resetConnectionForTests } from '../../src/persistence/db';

const local = (iso: string, zone: string) => DateTime.fromISO(iso).setZone(zone).toFormat('ccc yyyy-LL-dd HH:mm');

describe('recurrence', () => {
  it('daily runs at the same wall-clock time across a DST change (New York)', () => {
    const spec = { startsAtUTC: '2026-10-30T13:00:00Z', timezone: 'America/New_York', recurrence: { kind: 'daily' as const }, endDate: null, maxRuns: null };
    const list = occurrences(spec, { limit: 4 });
    expect(list.map((x) => local(x, 'America/New_York'))).toEqual(['Fri 2026-10-30 09:00', 'Sat 2026-10-31 09:00', 'Sun 2026-11-01 09:00', 'Mon 2026-11-02 09:00']);
    // Offset changes, so UTC hour changes from 13 to 14.
    expect(list[3]).toBe('2026-11-02T14:00:00.000Z');
  });

  it('every N hours is measured in elapsed time, not wall-clock', () => {
    const spec = { startsAtUTC: '2026-10-31T22:00:00Z', timezone: 'America/New_York', recurrence: { kind: 'hours' as const, everyHours: 6 }, endDate: null, maxRuns: null };
    const list = occurrences(spec, { limit: 4 });
    const gaps = list.slice(1).map((x, i) => (new Date(x).getTime() - new Date(list[i]).getTime()) / 3_600_000);
    expect(gaps).toEqual([6, 6, 6]);
  });

  it('selected weekdays only fire on chosen days in the selected timezone', () => {
    const spec = { startsAtUTC: '2026-10-15T04:00:00Z', timezone: 'Asia/Karachi', recurrence: { kind: 'weekdays' as const, weekdays: [1, 3, 5] }, endDate: null, maxRuns: null };
    const list = nextOccurrences(spec, '2026-10-15T00:00:00Z', 3);
    expect(list.map((x) => local(x, 'Asia/Karachi'))).toEqual(['Fri 2026-10-16 09:00', 'Mon 2026-10-19 09:00', 'Wed 2026-10-21 09:00']);
  });

  it('DST gap: nonexistent local time shifts forward by the gap', () => {
    const dt = resolveLocal('America/New_York', { year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 });
    expect(dt.toFormat('HH:mm')).toBe('03:30');
  });

  it('DST overlap: repeated local time runs once, at the earlier occurrence', () => {
    const spec = { startsAtUTC: '2026-10-31T05:30:00Z', timezone: 'America/New_York', recurrence: { kind: 'daily' as const }, endDate: '2026-11-02', maxRuns: null };
    const list = occurrences(spec, {});
    const nov1 = list.filter((x) => local(x, 'America/New_York').includes('2026-11-01'));
    expect(nov1).toHaveLength(1);
    expect(nov1[0]).toBe('2026-11-01T05:30:00.000Z'); // 01:30 EDT (earlier), not 01:30 EST
  });

  it('end date is inclusive in the schedule timezone and max runs caps output', () => {
    const base = { startsAtUTC: '2026-10-15T14:00:00Z', timezone: 'America/Los_Angeles', recurrence: { kind: 'daily' as const } };
    expect(occurrences({ ...base, endDate: '2026-10-17', maxRuns: null }, {})).toHaveLength(3);
    expect(occurrences({ ...base, endDate: null, maxRuns: 2 }, { limit: 10 })).toHaveLength(2);
  });

  it('the same instant displays correctly in Karachi and New York', () => {
    const instant = '2026-10-15T14:00:00Z';
    expect(local(instant, 'Asia/Karachi')).toBe('Thu 2026-10-15 19:00');
    expect(local(instant, 'America/New_York')).toBe('Thu 2026-10-15 10:00');
  });
});

describe('generation runs', () => {
  const T0 = new Date('2026-10-15T09:00:00Z');
  const ctx = (h: number): Ctx => ({ now: new Date(T0.getTime() + h * 3_600_000), actor: 'Administrator', role: 'admin' });

  function withOnce() {
    const d = buildSeed(T0, 'UTC');
    const s: GenerationSchedule = {
      ...d.schedules['sch_daily_shared'],
      id: 'sch_once',
      name: 'Once',
      recurrence: { kind: 'once' },
      startsAtUTC: new Date(T0.getTime() + 3_600_000).toISOString(),
      handledThroughUTC: null,
    };
    d.schedules[s.id] = s;
    return { d, s };
  }

  it('a once schedule creates unapproved drafts exactly once', () => {
    const { d, s } = withOnce();
    expect(dueOccurrences(s, ctx(0).now)).toHaveLength(0);
    const due = dueOccurrences(s, ctx(2).now);
    expect(due).toHaveLength(1);
    const key = occurrenceKey(s.id, due[0]);
    const run = runOccurrence(d, ctx(2), s.id, due[0], { manual: false, key })!;
    markHandled(d.schedules[s.id], due[0]);
    expect(run.campaignIds).toHaveLength(1);
    const groups = d.campaigns[run.campaignIds[0]].groupIds.map((id) => d.groups[id]);
    expect(groups.every((g) => g.reviewState === 'in_review' && g.currentApprovalId === null)).toBe(true);
    // Repeated tick: nothing due, and re-running the same key is refused.
    expect(dueOccurrences(d.schedules[s.id], ctx(5).now)).toHaveLength(0);
    expect(runOccurrence(d, ctx(5), s.id, due[0], { manual: false, key })).toBeNull();
  });

  it('run now uses its own key and leaves the next regular occurrence unchanged', () => {
    const d = buildSeed(T0, 'UTC');
    const s = d.schedules['sch_daily_shared'];
    const before = dueOccurrences(s, new Date(new Date(s.startsAtUTC).getTime() + 1));
    runOccurrence(d, ctx(0), s.id, ctx(0).now.toISOString(), { manual: true, key: `${s.id}@manual:1` });
    const after = dueOccurrences(d.schedules[s.id], new Date(new Date(s.startsAtUTC).getTime() + 1));
    expect(after).toEqual(before);
    expect(d.schedules[s.id].regularRunCount).toBe(0);
  });

  it('paused schedules are not reported as missed; missed runs can be skipped and are recorded', () => {
    const d = buildSeed(T0, 'UTC');
    const later = new Date(T0.getTime() + 5 * 86_400_000);
    const missed = findMissedRuns(d, later);
    expect(missed.map((m) => m.scheduleId)).not.toContain('sch_weekly_video');
    const daily = missed.find((m) => m.scheduleId === 'sch_daily_shared')!;
    expect(daily.instants.length).toBeGreaterThan(1);
    skipOccurrences(d, ctx(120), daily.scheduleId, daily.instants, 'test');
    markHandled(d.schedules[daily.scheduleId], daily.instants[daily.instants.length - 1]);
    expect(Object.values(d.runs).filter((r) => r.status === 'skipped')).toHaveLength(daily.instants.length);
    expect(dueOccurrences(d.schedules[daily.scheduleId], later)).toHaveLength(0);
  });

  it('IndexedDB claims make an occurrence unique across tabs', async () => {
    _resetConnectionForTests();
    const key = `occ:test-${Math.random()}`;
    const [a, b] = await Promise.all([claim(key), claim(key)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
