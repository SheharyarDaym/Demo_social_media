import { DEMO_LIMITS, FORMAT_LABEL, PLATFORM_LABEL, experienceLabel, formatNeedsVideo, isCompatible } from './rules';
import type { AppData, ContentGroup, ContentRevision, Delivery, Format, MediaAsset, Platform, Role } from './types';
import { contentHashOf, pickContent, renderCaption, xLength } from './util';

export type FixKind = 'split_video' | 'remove_destination' | 'separate_x';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  fix?: { kind: FixKind; destinationId: string };
}

export function platformsOf(data: Pick<AppData, 'destinations'>, destinationIds: string[]): Platform[] {
  return destinationIds.map((id) => data.destinations[id]?.platform).filter(Boolean) as Platform[];
}

/** Validate a group's content for submission/approval/publication. */
export function validateGroup(
  data: Pick<AppData, 'destinations' | 'media' | 'brand'>,
  group: Pick<ContentGroup, 'destinationIds' | 'format'>,
  rev: Pick<ContentRevision, 'caption' | 'hashtags' | 'ctaLink' | 'mediaIds' | 'meta'>,
): Issue[] {
  const issues: Issue[] = [];
  const format: Format = group.format;
  if (group.destinationIds.length === 0) {
    issues.push({ level: 'error', message: 'Choose at least one destination for this version.' });
  }
  for (const id of group.destinationIds) {
    const d = data.destinations[id];
    if (!d) continue;
    if (!isCompatible(d.platform, format)) {
      if (d.platform === 'youtube') {
        issues.push({
          level: 'error',
          message: 'YouTube needs a video. Move YouTube into a separate video version.',
          fix: { kind: 'split_video', destinationId: id },
        });
      } else if (d.platform === 'snapchat' && !formatNeedsVideo(format)) {
        issues.push({
          level: 'error',
          message: `Snapchat uses vertical Story images or Spotlight video in this preview, not ${FORMAT_LABEL[format].toLowerCase()}. Move Snapchat into a separate version.`,
          fix: { kind: 'split_video', destinationId: id },
        });
      } else {
        issues.push({
          level: 'error',
          message: `${PLATFORM_LABEL[d.platform]} does not support ${FORMAT_LABEL[format].toLowerCase()} in this preview. Move it into a separate version or remove it.`,
          fix: { kind: 'remove_destination', destinationId: id },
        });
      }
    }
    if (d.connection !== 'preview_connected') {
      issues.push({
        level: 'warning',
        message: `${PLATFORM_LABEL[d.platform]} is ${d.connection === 'disconnected' ? 'disconnected' : 'waiting for reconnection'} in this preview. Drafts are kept, but sending is blocked until it is reconnected.`,
      });
    }
  }
  if (!rev.caption.trim()) issues.push({ level: 'error', message: 'Add a caption before sending for approval.' });

  const media = rev.mediaIds.map((id) => data.media[id]).filter(Boolean) as MediaAsset[];
  if (media.length !== rev.mediaIds.length) {
    issues.push({ level: 'error', message: 'A selected media item is no longer available. Choose a replacement.' });
  }
  if (formatNeedsVideo(format)) {
    if (!media.some((m) => m.kind === 'video')) issues.push({ level: 'error', message: `${FORMAT_LABEL[format]} needs a video. Choose a video from the media library.` });
  } else {
    const images = media.filter((m) => m.kind === 'image');
    if (images.length === 0) issues.push({ level: 'error', message: `${FORMAT_LABEL[format]} needs an image. Generate or upload one.` });
    if (format === 'carousel' && images.length < 2) issues.push({ level: 'error', message: 'A carousel needs at least two images.' });
    if (media.some((m) => m.kind === 'video')) issues.push({ level: 'error', message: `${FORMAT_LABEL[format]} cannot include a video. Remove the video or change the format.` });
  }

  const platforms = platformsOf(data, group.destinationIds);
  if (platforms.includes('x')) {
    const len = xLength(rev.caption, rev.hashtags, rev.ctaLink);
    if (len > DEMO_LIMITS.xCaptionBudget) {
      issues.push({
        level: 'error',
        message: `The X caption is ${len}/${DEMO_LIMITS.xCaptionBudget} characters (demo validation rule). Shorten it${platforms.length > 1 ? ', or move X into a separate version' : ''}. Captions are never truncated automatically.`,
        fix: platforms.length > 1 ? { kind: 'separate_x', destinationId: group.destinationIds[platforms.indexOf('x')] } : undefined,
      });
    }
  }
  if (platforms.includes('youtube')) {
    const title = rev.meta.youtubeTitle.trim();
    if (!title) issues.push({ level: 'error', message: 'YouTube needs a title.' });
    else if (title.length > DEMO_LIMITS.youtubeTitleMax) issues.push({ level: 'error', message: `YouTube title is longer than ${DEMO_LIMITS.youtubeTitleMax} characters.` });
  }
  const rendered = renderCaption(rev.caption, rev.hashtags).toLowerCase();
  for (const claim of data.brand.prohibitedClaims) {
    const c = claim.trim().toLowerCase();
    if (c && rendered.includes(c)) issues.push({ level: 'error', message: `Caption contains a prohibited claim from Brand Settings: “${claim}”.` });
  }
  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

export interface GuardResult {
  ok: boolean;
  reason: string;
  kind: 'ok' | 'approval' | 'time' | 'role' | 'connection' | 'validation' | 'reconnect';
}

/**
 * Publishing guard: re-validates a delivery against the authoritative current store at execution time.
 * The scheduler and manual sends both go through this; UI-disabled buttons are not the enforcement point.
 */
export function guardDelivery(
  data: AppData,
  delivery: Delivery,
  opts: { now: Date; manual: boolean; role: Role },
): GuardResult {
  const fail = (kind: GuardResult['kind'], reason: string): GuardResult => ({ ok: false, kind, reason });
  const group = data.groups[delivery.groupId];
  if (!group) return fail('approval', 'This content version no longer exists.');
  if (opts.manual && opts.role !== 'admin') return fail('role', 'Only an Administrator can publish.');
  const approval = data.approvals[delivery.approvalId];
  if (!approval || approval.invalidatedAt) return fail('approval', 'Approval is no longer valid. Review the content again.');
  if (group.reviewState !== 'approved' || group.currentApprovalId !== approval.id) return fail('approval', 'This version is not currently approved.');
  if (group.currentRevisionId !== delivery.revisionId || approval.revisionId !== delivery.revisionId) {
    return fail('approval', 'This post changed after approval. Please review it again.');
  }
  const rev = data.revisions[delivery.revisionId];
  if (!rev || contentHashOf(pickContent(rev)) !== approval.contentHash || rev.contentHash !== approval.contentHash) {
    return fail('approval', 'Content does not match the approved snapshot.');
  }
  if (!approval.destinationIds.includes(delivery.destinationId) || !group.destinationIds.includes(delivery.destinationId)) {
    return fail('approval', 'This destination is not part of the approved version.');
  }
  const intent = approval.intents.find((i) => i.id === delivery.intentId);
  if (!intent || intent.destinationId !== delivery.destinationId) return fail('approval', 'No approved publication plan exists for this destination.');
  if (intent.mode === 'scheduled' && new Date(intent.scheduledAtUTC).getTime() > opts.now.getTime()) {
    return fail('time', 'The approved publication time has not arrived yet.');
  }
  const dest = data.destinations[delivery.destinationId];
  if (!dest) return fail('connection', 'Destination not found.');
  if (dest.connection === 'disconnected') return fail('connection', 'Destination is disconnected in this preview. Reconnect it, then choose Publish now or Reschedule.');
  if (dest.connection === 'reconnect_required') return fail('reconnect', 'Destination needs to be reconnected in this preview before sending.');
  const issues = validateGroup(data, group, rev).filter((i) => i.level === 'error');
  if (issues.length) return fail('validation', issues[0].message);
  return { ok: true, kind: 'ok', reason: '' };
}

export function experienceSummary(data: Pick<AppData, 'destinations'>, group: Pick<ContentGroup, 'destinationIds' | 'format'>): string {
  return group.destinationIds
    .map((id) => data.destinations[id])
    .filter(Boolean)
    .map((d) => `${PLATFORM_LABEL[d.platform]} ${experienceLabel(d.platform, group.format)}`)
    .join(', ');
}
