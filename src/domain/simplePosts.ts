// The simplified product: pick platforms, write a topic, generate, edit, approve to post now or later.
// This module maps that flow onto the existing domain (campaigns → content groups → revisions → deliveries).

import { createCampaign, iso, latestDeliveries, log, type Ctx } from './ops';
import { contentFromGenerated } from './generationRuns';
import { generateGroups } from '../services/fixtureEngine';
import { platformsOf } from './validation';
import { renderCaption, uid } from './util';
import { PLATFORM_LABEL } from './rules';
import type { AppData, Brief, Campaign, ContentGroup, Delivery, Format, GenerationSchedule, Platform, TopicKey } from './types';

const DEST_ID = (p: Platform) => `dest-${p}`;

export type PostMode = 'same' | 'different';

export const TOPIC_EXAMPLE = 'Create a post about lifeguard training for Lifeguard-Pro.org.';

/** Turn free text into a prepared topic (keyword match) or a safe custom-topic phrase. */
export function topicFromText(text: string): Pick<Brief, 'topic' | 'customTopic' | 'visualFamily'> {
  // Ignore the brand name itself so "…for Lifeguard-Pro.org" doesn't decide the topic.
  const t = text.toLowerCase().replace(/lifeguard-pro(\.org)?/g, '');
  const pick = (k: TopicKey) => ({ topic: k, customTopic: '', visualFamily: k });
  if (/\bteam|staff|together|colleague/.test(t)) return pick('team');
  if (/prepar|equipment|gear|ready|plan/.test(t)) return pick('preparedness');
  if (/question|course|ask|faq|enrol|enroll|class/.test(t)) return pick('questions');
  if (/lifeguard|training|train|certif|swim|pool|water safety/.test(t)) return pick('training');
  // Unknown subject: keep the user's wording inside a safe template.
  const phrase = text
    .replace(/^\s*(please\s+)?(create|write|make)\s+(a\s+)?(social\s+)?post\s+(about|on)\s+/i, '')
    .replace(/\s+for\s+lifeguard-pro\.org\.?\s*$/i, '')
    .replace(/[.!?\s]+$/, '')
    .trim();
  return { topic: 'custom', customTopic: phrase || 'your next learning goal', visualFamily: 'training' };
}

export function defaultBrief(text: string, website: string): Brief {
  void website;
  return {
    ...topicFromText(text),
    instructions: text.trim(),
    objective: 'awareness',
    audience: 'Aspiring lifeguards, aquatic teams and facility managers',
    tone: 'friendly',
    length: 'medium',
    cta: 'Explore training options',
  };
}

/** Format each platform uses in the simplified demo. YouTube always needs a video. */
export function formatFor(platform: Platform): Format {
  return platform === 'youtube' ? 'short_video' : 'image';
}

export interface CardSpec {
  name: string;
  destinationIds: string[];
  platforms: Platform[];
  format: Format;
}

/** Same post: one shared image card (+ a separate YouTube video card). Different: one card per platform. */
export function cardSpecs(platforms: Platform[], mode: PostMode): CardSpec[] {
  const ordered = platforms.filter((p, i) => platforms.indexOf(p) === i);
  if (mode === 'different') {
    return ordered.map((p) => ({ name: PLATFORM_LABEL[p], destinationIds: [DEST_ID(p)], platforms: [p], format: formatFor(p) }));
  }
  const images = ordered.filter((p) => p !== 'youtube');
  const specs: CardSpec[] = [];
  if (images.length) specs.push({ name: 'Shared post', destinationIds: images.map(DEST_ID), platforms: images, format: 'image' });
  if (ordered.includes('youtube')) specs.push({ name: 'YouTube video', destinationIds: [DEST_ID('youtube')], platforms: ['youtube'], format: 'short_video' });
  return specs;
}

export function titleFromText(text: string): string {
  const b = topicFromText(text);
  const base = b.topic === 'custom' ? b.customTopic : text.replace(/^\s*(create|write|make)\s+(a\s+)?post\s+(about|on)\s+/i, '').replace(/\s+for\s+lifeguard-pro\.org\.?\s*$/i, '');
  const clean = base.replace(/[.!?\s]+$/, '').trim() || 'New post';
  const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
  return cap.length > 60 ? `${cap.slice(0, 57)}…` : cap;
}

/** Create the campaign + cards for a generated post. Cards start unapproved ("Needs approval"). */
export function createPost(
  d: AppData,
  ctx: Ctx,
  input: { text: string; platforms: Platform[]; mode: PostMode; origin?: Campaign['origin'] },
): Campaign {
  const brief = defaultBrief(input.text, d.brand.website);
  const specs = cardSpecs(input.platforms, input.mode);
  const { contents, cursors } = generateGroups(
    brief,
    specs.map((s) => ({ destinationIds: s.destinationIds, platforms: s.platforms, format: s.format })),
    d.cursors,
  );
  d.cursors = cursors;
  // Same post: the YouTube video version carries the same wording as the shared image post.
  if (input.mode === 'same' && specs.length === 2) {
    contents[1] = { ...contents[1], caption: contents[0].caption, hashtags: [...contents[0].hashtags] };
  }
  return createCampaign(d, ctx, {
    title: titleFromText(input.text),
    brief,
    mode: input.mode === 'same' ? 'same' : 'separate',
    origin: input.origin,
    groups: specs.map((s, i) => ({
      name: s.name,
      destinationIds: s.destinationIds,
      format: s.format,
      content: contentFromGenerated(contents[i], d.brand.website),
      cursor: contents[i].cursor,
    })),
  });
}

// ---------------------------------------------------------------- statuses for My Posts

export type PostStatus = 'needs_approval' | 'scheduled' | 'posted' | 'hidden';

export interface PostState {
  status: PostStatus;
  deliveries: Delivery[];
  /** Earliest pending posting time, if scheduled. */
  scheduledAt: string | null;
  postedAt: string | null;
  /** A posting time passed while the preview was closed (or posting did not finish). */
  needsTimeReview: boolean;
}

export function postState(d: AppData, g: ContentGroup): PostState {
  const dels = latestDeliveries(d, g.id);
  const live = dels.filter((x) => x.status !== 'cancelled');
  const published = live.filter((x) => x.status === 'published_preview');
  const pending = live.filter((x) => x.status !== 'published_preview');
  const base = { deliveries: live, scheduledAt: null, postedAt: published.map((x) => x.receipt?.at ?? x.updatedAt).sort().pop() ?? null, needsTimeReview: false };
  if (g.reviewState === 'rejected') return { ...base, status: 'hidden' };
  if (published.length > 0 && published.length >= g.destinationIds.length) return { ...base, status: 'posted' };
  if (g.reviewState === 'approved' && pending.length > 0) {
    return {
      ...base,
      status: 'scheduled',
      scheduledAt: pending.map((x) => x.scheduledAtUTC).sort()[0],
      needsTimeReview: pending.some((x) => x.status === 'blocked' || x.status === 'failed' || x.status === 'processing'),
    };
  }
  return { ...base, status: 'needs_approval' };
}

export interface PostRow {
  campaign: Campaign;
  group: ContentGroup;
  platforms: Platform[];
  state: PostState;
}

export function postRows(d: AppData): PostRow[] {
  return Object.values(d.groups)
    .filter((g) => d.campaigns[g.campaignId] && !d.campaigns[g.campaignId].archived)
    .map((g) => ({ campaign: d.campaigns[g.campaignId], group: g, platforms: platformsOf(d, g.destinationIds), state: postState(d, g) }))
    .filter((r) => r.state.status !== 'hidden')
    .sort((a, b) => (d.revisions[a.group.currentRevisionId]?.createdAt < d.revisions[b.group.currentRevisionId]?.createdAt ? 1 : -1));
}

// ---------------------------------------------------------------- one text area for caption + hashtags

export function captionText(caption: string, hashtags: string[]): string {
  return renderCaption(caption, hashtags);
}

/** Split edited text back into caption + trailing hashtag line(s). */
export function parseCaptionText(text: string): { caption: string; hashtags: string[] } {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/);
  const last = paras[paras.length - 1]?.trim() ?? '';
  if (paras.length > 1 && last && /^(#[\p{L}\p{N}_]+\s*)+$/u.test(last)) {
    return { caption: paras.slice(0, -1).join('\n\n').trim(), hashtags: last.split(/\s+/).filter(Boolean) };
  }
  return { caption: text.trim(), hashtags: [] };
}

// ---------------------------------------------------------------- "Create later": one-time draft requests

export interface CreateLaterRequest {
  text: string;
  platforms: Platform[];
  mode: PostMode;
}

export function addCreateLater(d: AppData, ctx: Ctx, at: string, req: CreateLaterRequest, timezone: string): GenerationSchedule {
  const id = uid('later');
  const s: GenerationSchedule = {
    id,
    name: titleFromText(req.text),
    enabled: true,
    topicPool: ['training'],
    groups: cardSpecs(req.platforms, req.mode).map((c) => ({ name: c.name, destinationIds: c.destinationIds, format: c.format })),
    batchesPerRun: 1,
    tone: 'friendly',
    length: 'medium',
    startsAtUTC: at,
    timezone,
    recurrence: { kind: 'once' },
    endDate: null,
    maxRuns: 1,
    leadTimeHours: null,
    handledThroughUTC: null,
    regularRunCount: 0,
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
    createLater: { ...req },
  };
  d.schedules[id] = s;
  log(d, ctx, 'later.created', id, `Draft requested for later: “${s.name}”`);
  return s;
}

export function pendingCreateLater(d: AppData): GenerationSchedule[] {
  return Object.values(d.schedules)
    .filter((s) => s.createLater && s.enabled)
    .sort((a, b) => (a.startsAtUTC < b.startsAtUTC ? -1 : 1));
}

/** Run a draft request: record the run, create the unapproved post, remove the request from the list. */
export function runCreateLater(d: AppData, ctx: Ctx, scheduleId: string, key: string): Campaign | null {
  const s = d.schedules[scheduleId];
  if (!s?.createLater || !s.enabled) return null;
  if (Object.values(d.runs).some((r) => r.occurrenceKey === key)) return null;
  const runId = uid('run');
  d.runs[runId] = { id: runId, scheduleId, occurrenceKey: key, scheduledAt: s.startsAtUTC, startedAt: iso(ctx.now), manual: false, status: 'pending', campaignIds: [], note: '' };
  const campaign = createPost(d, { ...ctx, actor: 'Create later' }, { ...s.createLater, origin: { kind: 'schedule', scheduleId, runId } });
  d.runs[runId].campaignIds = [campaign.id];
  d.runs[runId].status = 'completed';
  s.enabled = false;
  s.handledThroughUTC = s.startsAtUTC;
  s.updatedAt = iso(ctx.now);
  log(d, ctx, 'later.ran', runId, `Draft created: “${campaign.title}” — needs approval`);
  return campaign;
}

export function cancelCreateLater(d: AppData, ctx: Ctx, scheduleId: string) {
  const s = d.schedules[scheduleId];
  if (!s) return;
  s.enabled = false;
  s.updatedAt = iso(ctx.now);
  log(d, ctx, 'later.cancelled', scheduleId, `Cancelled draft request “${s.name}”`);
}
