// Seed workspace: 10 campaigns across meaningful states, 3 generation schedules, 7 preview destinations.
// Times are relative to the seed clock (first launch), IDs are deterministic, and seeding happens once per
// seed version (never on every render).

import { DateTime } from 'luxon';
import { approveGroup, createCampaign, requestChanges, submitForReview, type Ctx } from '../domain/ops';
import { beginPublish, completePublish, takeFailure } from '../domain/publishing';
import { COMPATIBILITY, PLATFORMS, PLATFORM_LABEL } from '../domain/rules';
import { contentFromGenerated } from '../domain/generationRuns';
import { platformsOf } from '../domain/validation';
import { generateGroups } from '../services/fixtureEngine';
import type { AppData, Brief, Destination, Format, GenerationSchedule, GroupingMode, MediaAsset, Platform, TopicKey } from '../domain/types';
import { withDeterministicIds } from '../domain/util';
import { SEED_MEDIA } from './mediaCatalog';
import { DEFAULT_CTAS } from './captions';
import { createPost, TOPIC_EXAMPLE } from '../domain/simplePosts';

/** 1 = the earlier ten-campaign demo seed; 2 = the simplified three-example seed. */
export const SEED_VERSION = 2;
export const LEGACY_SEED_VERSION = 1;
export const SCHEMA_VERSION = 1;

export const DEST_ID = (p: Platform) => `dest-${p}`;

const DEST_NAMES: Record<Platform, string> = {
  facebook: 'sample Facebook Page',
  instagram: 'sample Instagram Business profile',
  linkedin: 'sample LinkedIn Page',
  x: 'sample X profile',
  snapchat: 'sample Snapchat Public Profile',
  tiktok: 'sample TikTok account',
  youtube: 'sample YouTube channel',
};

export function seedDestinations(): Record<string, Destination> {
  return Object.fromEntries(
    PLATFORMS.map((p) => [
      DEST_ID(p),
      { id: DEST_ID(p), platform: p, displayName: `Lifeguard-Pro.org — ${DEST_NAMES[p]}`, formatCapabilities: [...COMPATIBILITY[p]], connection: 'preview_connected' as const },
    ]),
  );
}

export function seedMedia(seededAt: string): Record<string, MediaAsset> {
  return Object.fromEntries(
    SEED_MEDIA.map((m) => [
      m.id,
      {
        id: m.id,
        kind: m.kind,
        source: 'bundled' as const,
        title: m.title,
        alt: m.alt,
        topic: m.topic,
        variants: m.variants,
        src: m.src ?? null,
        blobKey: null,
        poster: m.poster ?? null,
        mime: m.kind === 'video' ? 'video/webm' : 'image/svg+xml',
        width: m.width,
        height: m.height,
        durationSec: m.durationSec ?? null,
        sizeBytes: null,
        hidden: false,
        createdAt: seededAt,
        campaignHint: '',
      },
    ]),
  );
}

export function emptyData(now: Date, timezone: string): AppData {
  const seededAt = now.toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    brand: {
      name: 'Lifeguard-Pro.org',
      website: 'https://lifeguard-pro.org',
      audience: 'Aspiring lifeguards, aquatic teams and facility managers',
      voice: 'Clear, encouraging and practical. Invite questions; never promise outcomes.',
      primaryColor: '#062D5D',
      accentColor: '#E50914',
      logoMediaId: null,
      approvedFacts: ['Lifeguard-Pro.org is the organisation name', 'The team welcomes questions about training options'],
      prohibitedClaims: ['guaranteed job', 'guaranteed pass', '100% pass rate', 'certified in one day', 'cheapest'],
      approvedCtas: [...DEFAULT_CTAS],
      timezone,
    },
    destinations: seedDestinations(),
    campaigns: {},
    groups: {},
    revisions: {},
    media: seedMedia(seededAt),
    approvals: {},
    deliveries: {},
    schedules: {},
    runs: {},
    activity: [],
    notifications: [],
    preview: {
      role: 'admin',
      clockOffsetMs: 0,
      failure: { kind: 'none', destinationId: 'any' },
      seedVersion: SEED_VERSION,
      seededAtUTC: seededAt,
      lastActiveAtUTC: seededAt,
      missedPromptDismissed: false,
      failGenerationNext: false,
    },
    cursors: { caption: {}, hashtag: {}, image: {} },
    mockPlatformLedger: {},
  };
}

interface SeedCampaign {
  title: string;
  topic: TopicKey;
  tone?: Brief['tone'];
  length?: Brief['length'];
  mode: GroupingMode;
  groups: { platforms: Platform[]; format: Format; name?: string }[];
}

function brief(topic: TopicKey, tone: Brief['tone'] = 'friendly', length: Brief['length'] = 'medium'): Brief {
  return {
    topic,
    customTopic: '',
    visualFamily: topic,
    instructions: '',
    objective: topic === 'questions' ? 'engagement' : topic === 'team' ? 'educational' : 'awareness',
    audience: 'Aspiring lifeguards, aquatic teams and facility managers',
    tone,
    length,
    cta: topic === 'questions' ? 'Contact the team' : 'Explore training options',
  };
}

export function buildSeed(now: Date, timezone: string): AppData {
  return withDeterministicIds(() => {
    const d = emptyData(now, timezone);
    const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
    const admin = (hours: number): Ctx => ({ now: at(hours), actor: 'Administrator', role: 'admin' });
    const editor = (hours: number): Ctx => ({ now: at(hours), actor: 'Content editor', role: 'editor' });

    const make = (s: SeedCampaign, ctx: Ctx) => {
      const b = brief(s.topic, s.tone, s.length);
      const specs = s.groups.map((g) => ({ destinationIds: g.platforms.map(DEST_ID), platforms: g.platforms, format: g.format }));
      const { contents, cursors } = generateGroups(b, specs, d.cursors);
      d.cursors = cursors;
      return createCampaign(d, ctx, {
        title: s.title,
        brief: b,
        mode: s.mode,
        groups: s.groups.map((g, i) => ({
          name: g.name,
          destinationIds: specs[i].destinationIds,
          format: g.format,
          content: contentFromGenerated(contents[i], d.brand.website),
          cursor: contents[i].cursor,
        })),
      });
    };
    const validator = (groupId: string) => () => {
      const g = d.groups[groupId];
      return g.destinationIds.length ? null : 'no destinations';
    };
    const roundHour = (h: number) => DateTime.fromJSDate(at(h)).startOf('hour').toUTC().toISO()!;

    // 1. In review, shared Facebook + Instagram
    const c1 = make({ title: 'A confident start at the pool', topic: 'training', mode: 'same', groups: [{ platforms: ['facebook', 'instagram'], format: 'image' }]}, editor(-20));
    const g1 = d.groups[c1.groupIds[0]];
    g1.proposedTimes = { [DEST_ID('facebook')]: roundHour(30), [DEST_ID('instagram')]: roundHour(30) };
    submitForReview(d, editor(-19), g1.id);

    // 2. In review, LinkedIn
    const c2 = make({ title: 'Learning as a team', topic: 'team', tone: 'professional', mode: 'separate', groups: [{ platforms: ['linkedin'], format: 'image' }]}, editor(-16));
    submitForReview(d, editor(-15), c2.groupIds[0]);

    // 3. Draft, X
    make({ title: 'Your next training question', topic: 'questions', mode: 'separate', groups: [{ platforms: ['x'], format: 'image' }]}, editor(-9));

    // 4. In review, Instagram Story + Snapchat Story
    const c4 = make({ title: 'Prepare for your next step', topic: 'preparedness', length: 'short', mode: 'same', groups: [{ platforms: ['instagram', 'snapchat'], format: 'story' }]}, editor(-8));
    // Instagram already has a feed version elsewhere; this campaign is a Story-only plan.
    submitForReview(d, editor(-7), c4.groupIds[0]);

    // 5. Approved, future scheduled (Facebook + Instagram)
    const c5 = make({ title: 'A week of learning goals', topic: 'preparedness', mode: 'same', groups: [{ platforms: ['facebook', 'instagram'], format: 'carousel' }]}, editor(-30));
    const g5 = c5.groupIds[0];
    submitForReview(d, editor(-29), g5);
    const t5 = roundHour(5);
    approveGroup(d, admin(-6), g5, { mode: 'schedule', times: { [DEST_ID('facebook')]: t5, [DEST_ID('instagram')]: t5 }, displayTimezone: timezone }, validator(g5));

    // 6. Changes requested with internal note (LinkedIn)
    const c6 = make({ title: 'Questions for the team', topic: 'questions', tone: 'professional', mode: 'separate', groups: [{ platforms: ['linkedin'], format: 'image' }]}, editor(-26));
    const g6 = c6.groupIds[0];
    submitForReview(d, editor(-25), g6);
    requestChanges(d, admin(-4), g6, 'Please make the question more specific for aquatic facility managers, and keep the neutral call to action.');

    // 7. Draft, TikTok photo post
    make({ title: 'Training in focus', topic: 'training', tone: 'energetic', length: 'short', mode: 'separate', groups: [{ platforms: ['tiktok'], format: 'carousel' }]}, editor(-3));

    // 8. In review with video, YouTube Short
    const c8 = make({ title: 'Plan your next step', topic: 'training', mode: 'separate', groups: [{ platforms: ['youtube'], format: 'short_video' }]}, editor(-12));
    d.groups[c8.groupIds[0]].proposedTimes = { [DEST_ID('youtube')]: roundHour(48) };
    submitForReview(d, editor(-11), c8.groupIds[0]);

    // 9. Published in preview (historical receipts), Facebook + Instagram
    const c9 = make({ title: 'Learning together', topic: 'team', mode: 'same', groups: [{ platforms: ['facebook', 'instagram'], format: 'image' }]}, editor(-60));
    const g9 = c9.groupIds[0];
    submitForReview(d, editor(-59), g9);
    const dl9 = approveGroup(d, admin(-50), g9, { mode: 'now', displayTimezone: timezone }, validator(g9));
    for (const id of dl9) {
      beginPublish(d, admin(-50), id, { manual: true });
      completePublish(d, admin(-50), id);
    }

    // 10. Shared LinkedIn + X: LinkedIn success, X simulated failure (retry targets X only)
    const c10 = make({ title: 'Take time to prepare', topic: 'preparedness', tone: 'professional', length: 'short', mode: 'same', groups: [{ platforms: ['linkedin', 'x'], format: 'image' }]}, editor(-28));
    const g10 = c10.groupIds[0];
    submitForReview(d, editor(-27), g10);
    const dl10 = approveGroup(d, admin(-2), g10, { mode: 'now', displayTimezone: timezone }, validator(g10));
    for (const id of dl10) {
      const del = d.deliveries[id];
      if (del.destinationId === DEST_ID('x')) d.preview.failure = { kind: 'clear', destinationId: DEST_ID('x') };
      beginPublish(d, admin(-2), id, { manual: true });
      completePublish(d, admin(-2), id);
    }
    takeFailure(d, 'any');

    // Generation schedules
    const zone = timezone;
    const nextLocal = (hoursAhead: number) => DateTime.fromJSDate(at(hoursAhead)).setZone(zone).startOf('hour');
    const sched = (s: Omit<GenerationSchedule, 'createdAt' | 'updatedAt' | 'handledThroughUTC' | 'regularRunCount'>): GenerationSchedule => ({
      ...s,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      handledThroughUTC: null,
      regularRunCount: 0,
    });
    const daily = sched({
      id: 'sch_daily_shared',
      name: 'Daily shared Facebook + Instagram drafts',
      enabled: true,
      topicPool: ['training', 'questions', 'preparedness'],
      groups: [{ name: 'Shared feed', destinationIds: [DEST_ID('facebook'), DEST_ID('instagram')], format: 'image' }],
      batchesPerRun: 1,
      tone: 'friendly',
      length: 'medium',
      startsAtUTC: nextLocal(3).toUTC().toISO()!,
      timezone: zone,
      recurrence: { kind: 'daily' },
      endDate: null,
      maxRuns: null,
      leadTimeHours: 24,
    });
    const weeklyStart = nextLocal(24 + 2);
    const weekly = sched({
      id: 'sch_weekly_li_x',
      name: 'Weekly LinkedIn and X drafts',
      enabled: true,
      topicPool: ['team', 'questions'],
      groups: [
        { name: 'LinkedIn', destinationIds: [DEST_ID('linkedin')], format: 'image' },
        { name: 'X', destinationIds: [DEST_ID('x')], format: 'image' },
      ],
      batchesPerRun: 1,
      tone: 'professional',
      length: 'medium',
      startsAtUTC: weeklyStart.toUTC().toISO()!,
      timezone: zone,
      recurrence: { kind: 'weekly' },
      endDate: null,
      maxRuns: null,
      leadTimeHours: 48,
    });
    const video = sched({
      id: 'sch_weekly_video',
      name: 'Weekly video drafts',
      enabled: false,
      topicPool: ['training', 'team'],
      groups: [
        { name: 'YouTube Short', destinationIds: [DEST_ID('youtube')], format: 'short_video' },
        { name: 'TikTok video', destinationIds: [DEST_ID('tiktok')], format: 'short_video' },
      ],
      batchesPerRun: 1,
      tone: 'energetic',
      length: 'short',
      startsAtUTC: nextLocal(24 * 3 + 5).toUTC().toISO()!,
      timezone: zone,
      recurrence: { kind: 'weekly' },
      endDate: null,
      maxRuns: null,
      leadTimeHours: null,
    });
    d.schedules = { [daily.id]: daily, [weekly.id]: weekly, [video.id]: video };

    // Seeded notifications: keep only the attention-worthy ones unread.
    d.notifications.forEach((n) => (n.read = !(n.tone === 'error' || n.tone === 'warning')));
    d.activity.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    // Sanity: every seeded group must have compatible destinations.
    for (const g of Object.values(d.groups)) {
      for (const p of platformsOf(d, g.destinationIds)) {
        if (!COMPATIBILITY[p].includes(g.format)) throw new Error(`Seed incompatibility: ${PLATFORM_LABEL[p]} ${g.format}`);
      }
    }
    d.preview.lastActiveAtUTC = now.toISOString();
    d.preview.seedVersion = LEGACY_SEED_VERSION;
    return d;
  });
}

/**
 * Simplified demo seed: three examples — one needs approval, one scheduled, one posted in preview.
 * No generation requests are seeded, so "Drafts to create later" stays hidden until the user adds one.
 */
export function buildSimpleSeed(now: Date, timezone: string): AppData {
  return withDeterministicIds(() => {
    const d = emptyData(now, timezone);
    const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
    const admin = (hours: number): Ctx => ({ now: at(hours), actor: 'Administrator', role: 'admin' });
    const ok = () => null;

    // 1. Needs approval
    createPost(d, admin(-1), { text: TOPIC_EXAMPLE, platforms: ['facebook', 'instagram'], mode: 'same' });

    // 2. Scheduled: tomorrow at 10:00 local time
    const scheduled = createPost(d, admin(-3), { text: 'Create a post about team development for aquatic teams.', platforms: ['linkedin'], mode: 'same' });
    const g2 = scheduled.groupIds[0];
    submitForReview(d, admin(-2), g2);
    const tomorrow10 = DateTime.fromJSDate(now).setZone(timezone).plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
    approveGroup(d, admin(-2), g2, { mode: 'schedule', times: { [DEST_ID('linkedin')]: tomorrow10 }, displayTimezone: timezone }, ok);

    // 3. Posted in preview yesterday
    const posted = createPost(d, admin(-26), { text: 'Create a post inviting questions about training courses.', platforms: ['facebook', 'instagram'], mode: 'same' });
    const g3 = posted.groupIds[0];
    submitForReview(d, admin(-25), g3);
    for (const id of approveGroup(d, admin(-24), g3, { mode: 'now', displayTimezone: timezone }, ok)) {
      beginPublish(d, admin(-24), id, { manual: true });
      completePublish(d, admin(-24), id);
    }

    d.notifications.forEach((n) => (n.read = true));
    d.activity.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    d.preview.lastActiveAtUTC = now.toISOString();
    d.preview.seedVersion = SEED_VERSION;
    return d;
  });
}
