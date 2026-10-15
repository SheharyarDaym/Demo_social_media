// Pure state operations over a (cloned) AppData draft. The store clones, applies an op, then commits.
// Every rule that matters for approval/publication lives here so it can be unit-tested without React.

import { DEMO_LIMITS, GROUP_COLORS, PLATFORM_LABEL, defaultFormatFor, commonFormat, formatNeedsVideo } from './rules';
import type {
  AppData,
  Brief,
  Campaign,
  ContentGroup,
  ContentRevision,
  Delivery,
  DestinationMeta,
  Format,
  GenerationCursor,
  GroupingMode,
  PublicationIntent,
  ReviewEvent,
  Role,
} from './types';
import { contentHashOf, pickContent, uid, type RevisionContent } from './util';
import { platformsOf } from './validation';

export interface Ctx {
  now: Date;
  actor: string;
  role: Role;
}

export const iso = (d: Date) => d.toISOString();

export function actorName(role: Role): string {
  return role === 'admin' ? 'Administrator' : 'Content editor';
}

// ---------------------------------------------------------------- activity & notifications

export function log(d: AppData, ctx: Ctx, type: string, entityId: string, summary: string) {
  d.activity.unshift({ id: uid('act'), type, actor: ctx.actor, entityId, timestamp: iso(ctx.now), summary });
  if (d.activity.length > 400) d.activity.length = 400;
}

export function notify(
  d: AppData,
  ctx: Ctx,
  title: string,
  body: string,
  link: string,
  tone: 'info' | 'success' | 'warning' | 'error' = 'info',
) {
  d.notifications.unshift({ id: uid('ntf'), at: iso(ctx.now), title, body, link, read: false, tone });
  if (d.notifications.length > 150) d.notifications.length = 150;
}

function event(ctx: Ctx, action: ReviewEvent['action'], note: string, revisionNumber: number): ReviewEvent {
  return { id: uid('rev_evt'), at: iso(ctx.now), actor: ctx.actor, action, note, revisionNumber };
}

// ---------------------------------------------------------------- revisions

export const EMPTY_META: DestinationMeta = {
  youtubeTitle: '',
  youtubePrivacy: 'public',
  youtubeAudience: 'not_for_kids',
  syntheticDisclosure: 'none',
  tiktokCommercial: 'own_brand',
  tiktokAiLabel: false,
  storyHeadline: '',
};

export function emptyContent(brandWebsite: string): RevisionContent {
  return {
    caption: '',
    hashtags: [],
    ctaText: '',
    ctaLink: brandWebsite,
    mediaIds: [],
    thumbnailMediaId: null,
    crop: { fit: 'fill', focalX: 50, focalY: 50 },
    altText: {},
    meta: { ...EMPTY_META },
  };
}

function buildRevision(
  groupId: string,
  revisionNumber: number,
  content: RevisionContent,
  ctx: Ctx,
  note: string,
  cursor: GenerationCursor,
): ContentRevision {
  const c = structuredClone(content);
  return {
    id: uid('rev'),
    groupId,
    revisionNumber,
    ...c,
    contentHash: contentHashOf(c),
    createdAt: iso(ctx.now),
    author: ctx.actor,
    note,
    cursor: { ...cursor },
  };
}

export function currentRevision(d: AppData, groupId: string): ContentRevision {
  const g = d.groups[groupId];
  return d.revisions[g.currentRevisionId];
}

/**
 * Commit new content to a group as a new revision. If the content hash changed, approval is invalidated
 * and pending deliveries are suspended. Returns the new revision (or the current one if nothing changed).
 */
export function commitRevision(
  d: AppData,
  ctx: Ctx,
  groupId: string,
  content: RevisionContent,
  note: string,
  cursor?: GenerationCursor,
): ContentRevision {
  const g = d.groups[groupId];
  const prev = d.revisions[g.currentRevisionId];
  const hash = contentHashOf(content);
  if (prev && prev.contentHash === hash && (!cursor || JSON.stringify(cursor) === JSON.stringify(prev.cursor))) return prev;
  const rev = buildRevision(groupId, (prev?.revisionNumber ?? 0) + 1, content, ctx, note, cursor ?? prev.cursor);
  d.revisions[rev.id] = rev;
  g.revisionIds.push(rev.id);
  g.currentRevisionId = rev.id;
  touchCampaign(d, ctx, g.campaignId);
  if (!prev || prev.contentHash !== hash) onContentChanged(d, ctx, g, 'Content changed');
  return rev;
}

function touchCampaign(d: AppData, ctx: Ctx, campaignId: string) {
  const c = d.campaigns[campaignId];
  if (c) c.updatedAt = iso(ctx.now);
}

/** Apply review-state consequences of an approval-scope change. */
function onContentChanged(d: AppData, ctx: Ctx, g: ContentGroup, reason: string) {
  if (g.reviewState === 'approved') {
    invalidateApproval(d, ctx, g, reason);
  } else if (g.reviewState === 'changes_requested') {
    g.reviewState = 'draft';
  }
}

/** Invalidate a group's current approval and suspend its pending deliveries. Group returns to review. */
export function invalidateApproval(d: AppData, ctx: Ctx, g: ContentGroup, reason: string) {
  const ap = g.currentApprovalId ? d.approvals[g.currentApprovalId] : null;
  if (ap && !ap.invalidatedAt) {
    ap.invalidatedAt = iso(ctx.now);
    ap.invalidReason = reason;
    for (const del of Object.values(d.deliveries)) {
      if (del.approvalId === ap.id && isPending(del)) {
        del.status = 'cancelled';
        del.blockedReason = `Approval invalidated: ${reason.toLowerCase()}`;
        del.updatedAt = iso(ctx.now);
      }
    }
  }
  g.currentApprovalId = null;
  if (g.reviewState === 'approved') {
    g.reviewState = 'in_review';
    g.changedAfterApproval = true;
    const rn = d.revisions[g.currentRevisionId]?.revisionNumber ?? 0;
    g.history.push(event(ctx, 'invalidated', `${reason}. This post changed after approval. Please review it again.`, rn));
    log(d, ctx, 'approval.invalidated', g.id, `Approval invalidated for “${d.campaigns[g.campaignId]?.title}” (${g.name}): ${reason.toLowerCase()}`);
    notify(d, ctx, 'Approval needs renewal', `${d.campaigns[g.campaignId]?.title} — ${reason}.`, `/approvals?group=${g.id}`, 'warning');
  }
}

export function isPending(del: Delivery): boolean {
  return del.status === 'scheduled' || del.status === 'blocked' || del.status === 'not_scheduled' || (del.status === 'failed' && !del.receipt);
}

// ---------------------------------------------------------------- campaign & groups

export interface NewGroupInput {
  name?: string;
  destinationIds: string[];
  format: Format;
  content: RevisionContent;
  cursor: GenerationCursor;
  proposedTimes?: Record<string, string | null>;
}

export interface NewCampaignInput {
  title: string;
  brief: Brief;
  mode: GroupingMode;
  groups: NewGroupInput[];
  origin?: Campaign['origin'];
  reviewState?: 'draft' | 'in_review';
}

export function groupName(index: number): string {
  return `Version ${String.fromCharCode(65 + (index % 26))}`;
}

function nextGroupName(d: AppData, campaign: Campaign): string {
  const used = new Set(campaign.groupIds.map((id) => d.groups[id]?.name));
  for (let i = 0; i < 26; i++) if (!used.has(groupName(i))) return groupName(i);
  return `Version ${campaign.groupIds.length + 1}`;
}

function nextColor(d: AppData, campaign: Campaign): string {
  const used = new Set(campaign.groupIds.map((id) => d.groups[id]?.color));
  return GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[campaign.groupIds.length % GROUP_COLORS.length];
}

export function createCampaign(d: AppData, ctx: Ctx, input: NewCampaignInput): Campaign {
  const id = uid('cmp');
  const campaign: Campaign = {
    id,
    title: input.title.trim() || 'Untitled campaign',
    brief: structuredClone(input.brief),
    mode: input.mode,
    groupIds: [],
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
    createdBy: ctx.actor,
    archived: false,
    origin: input.origin ?? { kind: 'manual' },
    brandSnapshot: { name: d.brand.name, website: d.brand.website },
  };
  d.campaigns[id] = campaign;
  for (const gi of input.groups) addGroup(d, ctx, campaign, gi);
  if (input.reviewState === 'in_review') {
    for (const gid of campaign.groupIds) {
      const g = d.groups[gid];
      g.reviewState = 'in_review';
      g.history.push(event(ctx, 'submitted', 'Generated by schedule and sent to review', 1));
    }
  }
  log(d, ctx, 'campaign.created', id, `Created “${campaign.title}” with ${campaign.groupIds.length} content version${campaign.groupIds.length === 1 ? '' : 's'}`);
  return campaign;
}

export function addGroup(d: AppData, ctx: Ctx, campaign: Campaign, gi: NewGroupInput): ContentGroup {
  const gid = uid('grp');
  const group: ContentGroup = {
    id: gid,
    campaignId: campaign.id,
    name: gi.name ?? nextGroupName(d, campaign),
    color: nextColor(d, campaign),
    destinationIds: [...gi.destinationIds],
    format: gi.format,
    currentRevisionId: '',
    revisionIds: [],
    reviewState: 'draft',
    reviewNote: '',
    currentApprovalId: null,
    proposedTimes: { ...(gi.proposedTimes ?? {}) },
    changedAfterApproval: false,
    history: [event(ctx, 'created', 'Version created', 1)],
  };
  d.groups[gid] = group;
  campaign.groupIds.push(gid);
  const rev = buildRevision(gid, 1, gi.content, ctx, 'Created', gi.cursor);
  d.revisions[rev.id] = rev;
  group.revisionIds.push(rev.id);
  group.currentRevisionId = rev.id;
  return group;
}

/** Remove a destination from whichever group holds it in the campaign. Empty groups are removed. */
export function removeDestination(d: AppData, ctx: Ctx, campaignId: string, destinationId: string) {
  const c = d.campaigns[campaignId];
  for (const gid of [...c.groupIds]) {
    const g = d.groups[gid];
    if (!g.destinationIds.includes(destinationId)) continue;
    g.destinationIds = g.destinationIds.filter((x) => x !== destinationId);
    delete g.proposedTimes[destinationId];
    if (g.destinationIds.length === 0) {
      removeGroup(d, ctx, gid);
    } else {
      onDestinationsChanged(d, ctx, g, `${labelOf(d, destinationId)} removed`);
    }
  }
  touchCampaign(d, ctx, campaignId);
}

function labelOf(d: AppData, destinationId: string): string {
  const p = d.destinations[destinationId]?.platform;
  return p ? PLATFORM_LABEL[p] : 'Destination';
}

function onDestinationsChanged(d: AppData, ctx: Ctx, g: ContentGroup, reason: string) {
  if (g.reviewState === 'approved') invalidateApproval(d, ctx, g, reason);
  else if (g.reviewState === 'changes_requested') g.reviewState = 'draft';
}

export function removeGroup(d: AppData, ctx: Ctx, groupId: string) {
  const g = d.groups[groupId];
  if (!g) return;
  if (g.currentApprovalId) invalidateApproval(d, ctx, g, 'Version removed');
  for (const del of Object.values(d.deliveries)) {
    if (del.groupId === groupId && isPending(del)) {
      del.status = 'cancelled';
      del.blockedReason = 'Version removed';
    }
  }
  const c = d.campaigns[g.campaignId];
  c.groupIds = c.groupIds.filter((x) => x !== groupId);
  // Revisions stay in the store for audit; the group record is removed.
  delete d.groups[groupId];
}

/** Add a destination to an existing group (shared content). */
export function addDestinationToGroup(d: AppData, ctx: Ctx, groupId: string, destinationId: string) {
  const g = d.groups[groupId];
  if (g.destinationIds.includes(destinationId)) return;
  // A destination appears exactly once per campaign.
  removeDestination(d, ctx, g.campaignId, destinationId);
  if (!d.groups[groupId]) return;
  g.destinationIds.push(destinationId);
  onDestinationsChanged(d, ctx, g, `${labelOf(d, destinationId)} added`);
  touchCampaign(d, ctx, g.campaignId);
}

/**
 * Detach a destination from a shared group into a new independent group cloned from the source content.
 * The clone has new IDs, starts as a draft and inherits no approval.
 */
export function detachDestination(
  d: AppData,
  ctx: Ctx,
  groupId: string,
  destinationId: string,
  opts?: { format?: Format; content?: RevisionContent; cursor?: GenerationCursor },
): ContentGroup {
  const src = d.groups[groupId];
  const c = d.campaigns[src.campaignId];
  const srcRev = d.revisions[src.currentRevisionId];
  const proposed = src.proposedTimes[destinationId] ?? null;
  if (src.destinationIds.length > 1) {
    src.destinationIds = src.destinationIds.filter((x) => x !== destinationId);
    delete src.proposedTimes[destinationId];
    onDestinationsChanged(d, ctx, src, `${labelOf(d, destinationId)} detached into a separate version`);
  }
  const clone = addGroup(d, ctx, c, {
    destinationIds: [destinationId],
    format: opts?.format ?? src.format,
    content: opts?.content ?? pickContent(srcRev),
    cursor: opts?.cursor ?? srcRev.cursor,
    proposedTimes: { [destinationId]: proposed },
  });
  if (src.destinationIds.length === 1 && src.destinationIds[0] === destinationId) {
    // Detaching the only member: replace the source entirely.
    removeGroup(d, ctx, src.id);
  }
  if (c.mode === 'same') c.mode = 'custom';
  log(d, ctx, 'group.detached', clone.id, `Detached ${labelOf(d, destinationId)} into ${clone.name} of “${c.title}”`);
  return clone;
}

/** Move a destination into another existing group of the same campaign. */
export function moveDestination(d: AppData, ctx: Ctx, destinationId: string, toGroupId: string) {
  addDestinationToGroup(d, ctx, toGroupId, destinationId);
  const g = d.groups[toGroupId];
  if (g) {
    const c = d.campaigns[g.campaignId];
    if (c.mode !== 'custom') c.mode = 'custom';
  }
}

export function setGroupFormat(d: AppData, ctx: Ctx, groupId: string, format: Format, content: RevisionContent, cursor?: GenerationCursor) {
  const g = d.groups[groupId];
  if (g.format === format) return;
  g.format = format;
  commitRevision(d, ctx, groupId, content, `Format changed to ${format}`, cursor);
  onDestinationsChanged(d, ctx, g, 'Format changed');
}

export function renameGroup(d: AppData, groupId: string, name: string) {
  const g = d.groups[groupId];
  if (g) g.name = name.trim().slice(0, 40) || g.name;
}

export function updateCampaignMeta(d: AppData, ctx: Ctx, campaignId: string, patch: { title?: string; brief?: Partial<Brief> }) {
  const c = d.campaigns[campaignId];
  if (patch.title !== undefined) c.title = patch.title.trim() || c.title;
  if (patch.brief) c.brief = { ...c.brief, ...patch.brief };
  touchCampaign(d, ctx, campaignId);
}

/** Default group layout for a destination set and mode. */
export function layoutGroups(
  d: Pick<AppData, 'destinations'>,
  destinationIds: string[],
  mode: GroupingMode,
): { destinationIds: string[]; format: Format }[] {
  if (destinationIds.length === 0) return [];
  if (mode === 'same') {
    const platforms = platformsOf(d, destinationIds);
    return [{ destinationIds: [...destinationIds], format: commonFormat(platforms) ?? 'image' }];
  }
  return destinationIds.map((id) => ({ destinationIds: [id], format: defaultFormatFor(d.destinations[id].platform) }));
}

// ---------------------------------------------------------------- proposed times

export function setProposedTime(d: AppData, ctx: Ctx, groupId: string, destinationId: string, at: string | null) {
  const g = d.groups[groupId];
  if ((g.proposedTimes[destinationId] ?? null) === at) return;
  g.proposedTimes[destinationId] = at;
  if (g.reviewState === 'approved') invalidateApproval(d, ctx, g, 'Publication time changed');
}

// ---------------------------------------------------------------- review workflow

export function submitForReview(d: AppData, ctx: Ctx, groupId: string): boolean {
  const g = d.groups[groupId];
  if (!['draft', 'changes_requested'].includes(g.reviewState)) return false;
  g.reviewState = 'in_review';
  g.reviewNote = '';
  const rn = d.revisions[g.currentRevisionId].revisionNumber;
  g.history.push(event(ctx, 'submitted', 'Sent for approval', rn));
  log(d, ctx, 'review.submitted', g.id, `Sent “${d.campaigns[g.campaignId].title}” (${g.name}) for approval`);
  notify(d, ctx, 'New post awaiting approval', `${d.campaigns[g.campaignId].title} — ${g.name}`, `/approvals?group=${g.id}`, 'info');
  return true;
}

export class ReviewError extends Error {}

function assertAdmin(ctx: Ctx) {
  if (ctx.role !== 'admin') throw new ReviewError('Only an Administrator can approve, reject or request changes.');
}

function assertSeen(d: AppData, g: ContentGroup, expectedRevisionId: string | undefined) {
  if (expectedRevisionId && g.currentRevisionId !== expectedRevisionId) {
    const rn = d.revisions[g.currentRevisionId].revisionNumber;
    throw new ReviewError(`A newer revision (r${rn}) arrived while you were reviewing. Review it before taking action.`);
  }
}

export function requestChanges(d: AppData, ctx: Ctx, groupId: string, note: string, expectedRevisionId?: string) {
  assertAdmin(ctx);
  const g = d.groups[groupId];
  assertSeen(d, g, expectedRevisionId);
  if (!note.trim()) throw new ReviewError('Add a note explaining what should change.');
  if (g.currentApprovalId) invalidateApproval(d, ctx, g, 'Changes requested');
  g.reviewState = 'changes_requested';
  g.reviewNote = note.trim();
  g.history.push(event(ctx, 'changes_requested', note.trim(), d.revisions[g.currentRevisionId].revisionNumber));
  log(d, ctx, 'review.changes_requested', g.id, `Requested changes on “${d.campaigns[g.campaignId].title}” (${g.name})`);
  notify(d, ctx, 'Changes requested', note.trim(), `/create/${g.campaignId}?group=${g.id}`, 'warning');
}

export function rejectGroup(d: AppData, ctx: Ctx, groupId: string, note: string, expectedRevisionId?: string) {
  assertAdmin(ctx);
  const g = d.groups[groupId];
  assertSeen(d, g, expectedRevisionId);
  if (!note.trim()) throw new ReviewError('A note is required to reject.');
  if (g.currentApprovalId) invalidateApproval(d, ctx, g, 'Rejected');
  g.reviewState = 'rejected';
  g.reviewNote = note.trim();
  g.history.push(event(ctx, 'rejected', note.trim(), d.revisions[g.currentRevisionId].revisionNumber));
  log(d, ctx, 'review.rejected', g.id, `Rejected “${d.campaigns[g.campaignId].title}” (${g.name})`);
}

export function reopenGroup(d: AppData, ctx: Ctx, groupId: string) {
  const g = d.groups[groupId];
  if (g.reviewState !== 'rejected') return;
  g.reviewState = 'draft';
  g.history.push(event(ctx, 'reopened', 'Reopened as a draft for revision', d.revisions[g.currentRevisionId].revisionNumber));
}

export function addComment(d: AppData, ctx: Ctx, groupId: string, note: string) {
  const g = d.groups[groupId];
  if (!note.trim()) return;
  // Internal comments never affect approval scope.
  g.history.push(event(ctx, 'comment', note.trim(), d.revisions[g.currentRevisionId].revisionNumber));
}

export type ApproveMode = 'only' | 'now' | 'schedule';

export interface ApproveInput {
  mode: ApproveMode;
  /** Required for `schedule`: future UTC instant per destination. */
  times?: Record<string, string>;
  displayTimezone: string;
  expectedRevisionId?: string;
}

/**
 * Approve the exact current revision + destination set (+ publication plan). Creates an immutable snapshot.
 * Returns created delivery ids. Validation errors and unseen revisions throw.
 */
export function approveGroup(d: AppData, ctx: Ctx, groupId: string, input: ApproveInput, validate: () => string | null): string[] {
  assertAdmin(ctx);
  const g = d.groups[groupId];
  assertSeen(d, g, input.expectedRevisionId);
  if (!['in_review', 'approved'].includes(g.reviewState)) throw new ReviewError('Only content that is in review can be approved.');
  const err = validate();
  if (err) throw new ReviewError(err);
  const rev = d.revisions[g.currentRevisionId];
  if (input.mode === 'schedule') {
    for (const dest of g.destinationIds) {
      if (Object.values(d.deliveries).some((x) => x.groupId === g.id && x.revisionId === rev.id && x.destinationId === dest && x.status === 'published_preview')) continue;
      const t = input.times?.[dest];
      if (!t) throw new ReviewError(`Choose a publication time for ${labelOf(d, dest)}.`);
      if (new Date(t).getTime() <= ctx.now.getTime()) throw new ReviewError(`The time for ${labelOf(d, dest)} has already passed. Choose a future time or publish now.`);
    }
  }
  // Supersede any earlier approval (e.g. approve-only followed by a schedule decision).
  if (g.currentApprovalId) {
    const old = d.approvals[g.currentApprovalId];
    if (old && !old.invalidatedAt) {
      old.invalidatedAt = iso(ctx.now);
      old.invalidReason = 'Superseded by a newer approval';
      for (const del of Object.values(d.deliveries)) {
        if (del.approvalId === old.id && isPending(del)) {
          del.status = 'cancelled';
          del.blockedReason = 'Superseded by a newer approval';
        }
      }
    }
  }
  const approvalId = uid('apr');
  // Never plan a second send of the same revision to a destination that already has a preview receipt.
  const alreadyPublished = new Set(
    Object.values(d.deliveries)
      .filter((x) => x.groupId === g.id && x.revisionId === rev.id && x.status === 'published_preview')
      .map((x) => x.destinationId),
  );
  const intents: PublicationIntent[] =
    input.mode === 'only'
      ? []
      : g.destinationIds.filter((dest) => !alreadyPublished.has(dest)).map((dest) => ({
          id: uid('int'),
          destinationId: dest,
          revisionId: rev.id,
          mode: input.mode === 'now' ? 'now' : 'scheduled',
          scheduledAtUTC: input.mode === 'now' ? iso(ctx.now) : input.times![dest],
          displayTimezone: input.displayTimezone,
        }));
  d.approvals[approvalId] = {
    id: approvalId,
    groupId,
    revisionId: rev.id,
    revisionNumber: rev.revisionNumber,
    contentHash: rev.contentHash,
    destinationIds: [...g.destinationIds],
    intents,
    approvedBy: ctx.actor,
    approvedAt: iso(ctx.now),
    invalidatedAt: null,
    invalidReason: '',
  };
  g.reviewState = 'approved';
  g.currentApprovalId = approvalId;
  g.changedAfterApproval = false;
  g.reviewNote = '';
  for (const it of intents) g.proposedTimes[it.destinationId] = it.scheduledAtUTC;
  const modeText = input.mode === 'only' ? 'Approved only' : input.mode === 'now' ? 'Approved and publishing now' : 'Approved and scheduled';
  g.history.push(event(ctx, 'approved', modeText, rev.revisionNumber));
  const deliveryIds = intents.map((it) => createDelivery(d, ctx, g, approvalId, it));
  log(d, ctx, 'review.approved', g.id, `${modeText}: “${d.campaigns[g.campaignId].title}” (${g.name}, r${rev.revisionNumber})`);
  return deliveryIds;
}

export function deliveryKeyOf(campaignId: string, groupId: string, revisionId: string, destinationId: string, intentId: string) {
  return [campaignId, groupId, revisionId, destinationId, intentId].join('|');
}

function createDelivery(d: AppData, ctx: Ctx, g: ContentGroup, approvalId: string, it: PublicationIntent): string {
  const key = deliveryKeyOf(g.campaignId, g.id, it.revisionId, it.destinationId, it.id);
  const existing = Object.values(d.deliveries).find((x) => x.deliveryKey === key);
  if (existing) return existing.id;
  const id = uid('dlv');
  d.deliveries[id] = {
    id,
    campaignId: g.campaignId,
    groupId: g.id,
    destinationId: it.destinationId,
    revisionId: it.revisionId,
    approvalId,
    intentId: it.id,
    deliveryKey: key,
    status: 'scheduled',
    scheduledAtUTC: it.scheduledAtUTC,
    attempts: 0,
    maxAttempts: DEMO_LIMITS.maxPublishAttempts,
    nextRetryAt: null,
    receipt: null,
    error: null,
    blockedReason: '',
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
  };
  return id;
}

/** Cancel a pending publication. Content is never deleted. */
export function cancelDelivery(d: AppData, ctx: Ctx, deliveryId: string) {
  const del = d.deliveries[deliveryId];
  if (!del || !isPending(del)) return;
  del.status = 'cancelled';
  del.blockedReason = 'Cancelled by an administrator';
  del.updatedAt = iso(ctx.now);
  log(d, ctx, 'delivery.cancelled', del.id, `Cancelled ${labelOf(d, del.destinationId)} publication of “${d.campaigns[del.campaignId]?.title}”`);
}

/** Rescheduling changes the approved plan, so approval is invalidated and the group returns to review. */
export function rescheduleDelivery(d: AppData, ctx: Ctx, deliveryId: string, at: string) {
  const del = d.deliveries[deliveryId];
  if (!del) return;
  const g = d.groups[del.groupId];
  if (!g) return;
  g.proposedTimes[del.destinationId] = at;
  if (g.reviewState === 'approved') invalidateApproval(d, ctx, g, 'Publication time changed');
  if (isPending(del)) {
    del.status = 'cancelled';
    del.blockedReason = 'Rescheduled — waiting for renewed approval';
    del.updatedAt = iso(ctx.now);
  }
  log(d, ctx, 'delivery.rescheduled', del.id, `Rescheduled ${labelOf(d, del.destinationId)} for “${d.campaigns[del.campaignId]?.title}” — approval required again`);
}

// ---------------------------------------------------------------- duplication & archive

export function duplicateCampaign(d: AppData, ctx: Ctx, campaignId: string, titleSuffix = ' (copy)'): Campaign {
  const src = d.campaigns[campaignId];
  const copy = createCampaign(d, ctx, {
    title: `${src.title}${titleSuffix}`,
    brief: src.brief,
    mode: src.mode,
    groups: src.groupIds.map((gid) => {
      const g = d.groups[gid];
      const r = d.revisions[g.currentRevisionId];
      return { name: g.name, destinationIds: g.destinationIds, format: g.format, content: pickContent(r), cursor: r.cursor };
    }),
  });
  return copy;
}

export function archiveCampaign(d: AppData, ctx: Ctx, campaignId: string, archived: boolean) {
  const c = d.campaigns[campaignId];
  c.archived = archived;
  if (archived) {
    for (const gid of c.groupIds) {
      for (const del of Object.values(d.deliveries)) {
        if (del.groupId === gid && isPending(del)) {
          del.status = 'cancelled';
          del.blockedReason = 'Campaign archived';
        }
      }
    }
  }
  log(d, ctx, archived ? 'campaign.archived' : 'campaign.restored', campaignId, `${archived ? 'Archived' : 'Restored'} “${c.title}”`);
}

// ---------------------------------------------------------------- derived status

export type CampaignStatus =
  | 'Draft'
  | 'In review'
  | 'Changes requested'
  | 'Rejected'
  | 'Approved'
  | 'Scheduled'
  | 'Published in preview'
  | 'Partially published'
  | 'Needs attention';

export function latestDeliveries(d: AppData, groupId: string): Delivery[] {
  const g = d.groups[groupId];
  if (!g) return [];
  const byDest = new Map<string, Delivery>();
  for (const del of Object.values(d.deliveries)) {
    if (del.groupId !== groupId) continue;
    const cur = byDest.get(del.destinationId);
    if (!cur || del.createdAt > cur.createdAt || (del.createdAt === cur.createdAt && del.id > cur.id)) byDest.set(del.destinationId, del);
  }
  return g.destinationIds.map((id) => byDest.get(id)).filter(Boolean) as Delivery[];
}

export function deliveryNeedsAttention(del: Delivery): boolean {
  return del.status === 'failed' || del.status === 'blocked' || del.status === 'processing';
}

export function groupNeedsAttention(d: AppData, g: ContentGroup, now: Date): boolean {
  if (latestDeliveries(d, g.id).some(deliveryNeedsAttention)) return true;
  return proposedTimePassed(g, now);
}

/** A proposed publication time passed while the group was still awaiting approval. */
export function proposedTimePassed(g: ContentGroup, now: Date): boolean {
  if (g.reviewState !== 'in_review') return false;
  return Object.values(g.proposedTimes).some((t) => t && new Date(t).getTime() <= now.getTime());
}

export function campaignStatus(d: AppData, c: Campaign, now: Date): CampaignStatus {
  const groups = c.groupIds.map((id) => d.groups[id]).filter(Boolean);
  const dels = groups.flatMap((g) => latestDeliveries(d, g.id));
  if (groups.some((g) => groupNeedsAttention(d, g, now))) return 'Needs attention';
  const published = dels.filter((x) => x.status === 'published_preview').length;
  const totalDest = groups.reduce((n, g) => n + g.destinationIds.length, 0);
  if (published > 0 && published === totalDest) return 'Published in preview';
  if (published > 0) return 'Partially published';
  if (dels.some((x) => x.status === 'scheduled' || x.status === 'publishing')) return 'Scheduled';
  if (groups.length && groups.every((g) => g.reviewState === 'approved')) return 'Approved';
  if (groups.some((g) => g.reviewState === 'changes_requested')) return 'Changes requested';
  if (groups.some((g) => g.reviewState === 'in_review')) return 'In review';
  if (groups.length && groups.every((g) => g.reviewState === 'rejected')) return 'Rejected';
  if (groups.some((g) => g.reviewState === 'approved')) return 'Approved';
  return 'Draft';
}

/** Is this format's media set consistent (video vs image)? Used when switching formats. */
export function mediaMatchesFormat(d: AppData, mediaIds: string[], format: Format): boolean {
  const kinds = mediaIds.map((id) => d.media[id]?.kind);
  if (formatNeedsVideo(format)) return kinds.length > 0 && kinds.every((k) => k === 'video');
  return kinds.length > 0 && kinds.every((k) => k === 'image');
}
