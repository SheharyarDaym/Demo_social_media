// Generation schedule execution. A run creates unapproved drafts that always enter review.
// Generation schedules never approve or publish anything.

import { DateTime } from 'luxon';
import { TOPICS } from '../fixtures/captions';
import { generateGroups, type GeneratedContent } from '../services/fixtureEngine';
import { createCampaign, iso, log, notify, type Ctx } from './ops';
import { occurrenceKey, occurrences } from './recurrence';
import { platformsOf } from './validation';
import type { AppData, Brief, GenerationRun, GenerationSchedule, GroupingMode } from './types';
import type { RevisionContent } from './util';
import { uid } from './util';

export function contentFromGenerated(g: GeneratedContent, website: string): RevisionContent {
  return {
    caption: g.caption,
    hashtags: g.hashtags,
    ctaText: g.ctaText,
    ctaLink: website,
    mediaIds: g.mediaIds,
    thumbnailMediaId: g.thumbnailMediaId,
    crop: { fit: 'fill', focalX: 50, focalY: 50 },
    altText: {},
    meta: g.meta,
  };
}

/** Regular occurrences due (not yet handled) at `now`. */
export function dueOccurrences(s: GenerationSchedule, now: Date, limit = 500): string[] {
  const after = s.handledThroughUTC ?? new Date(new Date(s.startsAtUTC).getTime() - 1).toISOString();
  return occurrences(s, { afterExclusive: after, untilInclusive: now.toISOString(), limit });
}

export function nextRegularOccurrence(s: GenerationSchedule, now: Date): string | null {
  const nowISO = now.toISOString();
  const lowerBound = s.handledThroughUTC && s.handledThroughUTC > nowISO ? s.handledThroughUTC : nowISO;
  return occurrences(s, { afterExclusive: lowerBound, limit: 1 })[0] ?? null;
}

export function versionsPerRun(s: Pick<GenerationSchedule, 'groups' | 'batchesPerRun'>): number {
  return s.groups.length * s.batchesPerRun;
}

function modeFor(groups: { destinationIds: string[] }[]): GroupingMode {
  if (groups.length === 1) return 'same';
  if (groups.every((g) => g.destinationIds.length === 1)) return 'separate';
  return 'custom';
}

/**
 * Execute one occurrence: record the run first (pending), then create drafts, then complete.
 * The caller must have claimed `key` (in-memory + IndexedDB uniqueness) before calling.
 */
export function runOccurrence(
  d: AppData,
  ctx: Ctx,
  scheduleId: string,
  instantISO: string,
  opts: { manual: boolean; key: string },
): GenerationRun | null {
  const s = d.schedules[scheduleId];
  if (!s) return null;
  if (Object.values(d.runs).some((r) => r.occurrenceKey === opts.key)) return null;
  const run: GenerationRun = {
    id: uid('run'),
    scheduleId,
    occurrenceKey: opts.key,
    scheduledAt: instantISO,
    startedAt: iso(ctx.now),
    manual: opts.manual,
    status: 'pending',
    campaignIds: [],
    note: '',
  };
  d.runs[run.id] = run;
  const genCtx: Ctx = { ...ctx, actor: `Generation schedule: ${s.name}` };
  const runIndex = Object.values(d.runs).filter((r) => r.scheduleId === scheduleId && r.status !== 'skipped').length - 1;
  const localDate = DateTime.fromISO(instantISO).setZone(s.timezone).toFormat('LLL d, HH:mm');
  for (let b = 0; b < s.batchesPerRun; b++) {
    const topic = s.topicPool[(runIndex * s.batchesPerRun + b) % s.topicPool.length] ?? 'training';
    const brief: Brief = {
      topic,
      customTopic: '',
      visualFamily: topic,
      instructions: '',
      objective: 'awareness',
      audience: d.brand.audience,
      tone: s.tone,
      length: s.length,
      cta: d.brand.approvedCtas[0] ?? 'Explore training options',
    };
    const templates = s.groups.filter((g) => g.destinationIds.length > 0);
    const specs = templates.map((g) => ({ destinationIds: g.destinationIds, platforms: platformsOf(d, g.destinationIds), format: g.format }));
    const { contents, cursors } = generateGroups(brief, specs, d.cursors);
    d.cursors = cursors;
    const proposedAt = s.leadTimeHours ? new Date(new Date(instantISO).getTime() + s.leadTimeHours * 3_600_000).toISOString() : null;
    const campaign = createCampaign(d, genCtx, {
      title: `${TOPICS[topic].label} · ${s.name} · ${localDate}`,
      brief,
      mode: modeFor(s.groups),
      origin: { kind: 'schedule', scheduleId, runId: run.id },
      reviewState: 'in_review',
      groups: templates.map((g, i) => ({
        name: g.name,
        destinationIds: g.destinationIds,
        format: g.format,
        content: contentFromGenerated(contents[i], d.brand.website),
        cursor: contents[i].cursor,
        proposedTimes: Object.fromEntries(g.destinationIds.map((id) => [id, proposedAt])),
      })),
    });
    run.campaignIds.push(campaign.id);
  }
  run.status = 'completed';
  if (!opts.manual) s.regularRunCount += 1;
  const n = run.campaignIds.length * s.groups.length;
  log(d, ctx, opts.manual ? 'generation.manual_run' : 'generation.run', run.id, `${opts.manual ? 'Run now' : 'Scheduled run'}: “${s.name}” created ${n} draft version${n === 1 ? '' : 's'} for review`);
  notify(d, ctx, 'New drafts awaiting review', `${s.name} created ${n} version${n === 1 ? '' : 's'}.`, '/approvals', 'info');
  return run;
}

export function skipOccurrences(d: AppData, ctx: Ctx, scheduleId: string, instants: string[], note: string) {
  const s = d.schedules[scheduleId];
  if (!s) return;
  for (const t of instants) {
    const key = occurrenceKey(scheduleId, t);
    if (Object.values(d.runs).some((r) => r.occurrenceKey === key)) continue;
    const id = uid('run');
    d.runs[id] = {
      id,
      scheduleId,
      occurrenceKey: key,
      scheduledAt: t,
      startedAt: iso(ctx.now),
      manual: false,
      status: 'skipped',
      campaignIds: [],
      note,
    };
    s.regularRunCount += 1;
  }
  if (instants.length) log(d, ctx, 'generation.skipped', scheduleId, `Skipped ${instants.length} occurrence${instants.length === 1 ? '' : 's'} of “${s.name}”: ${note}`);
}

export function markHandled(s: GenerationSchedule, through: string) {
  if (!s.handledThroughUTC || through > s.handledThroughUTC) s.handledThroughUTC = through;
}

export interface MissedRuns {
  scheduleId: string;
  instants: string[];
}

/** Occurrences that came due while the app was closed. Not executed until the admin chooses. */
export function findMissedRuns(d: AppData, now: Date): MissedRuns[] {
  return Object.values(d.schedules)
    .filter((s) => s.enabled)
    .map((s) => ({ scheduleId: s.id, instants: dueOccurrences(s, now) }))
    .filter((m) => m.instants.length > 0);
}
