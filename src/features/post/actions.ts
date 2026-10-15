import { act, publishDelivery, toast, useStore } from '../../store/store';
import { approveGroup, commitRevision, invalidateApproval, ReviewError, submitForReview } from '../../domain/ops';
import { validateGroup } from '../../domain/validation';
import { nextCaption, nextImage, topicKeyOf } from '../../services/fixtureEngine';
import { platformsOf } from '../../domain/validation';
import { pickContent } from '../../domain/util';
import { parseCaptionText } from '../../domain/simplePosts';
import { formatNeedsVideo } from '../../domain/rules';

function current(groupId: string) {
  const d = useStore.getState().data;
  const g = d.groups[groupId];
  const r = g ? d.revisions[g.currentRevisionId] : undefined;
  return { d, g, r };
}

/** Save edited caption text (caption + hashtags in one text area). Changing approved content needs approval again. */
export function saveCaptionText(groupId: string, text: string) {
  const { g, r } = current(groupId);
  if (!g || !r) return;
  const parsed = parseCaptionText(text);
  act((d, c) => commitRevision(d, c, groupId, { ...pickContent(r), caption: parsed.caption, hashtags: parsed.hashtags }, 'Edited'));
}

/** Next prepared wording; keeps the image. */
export function rewriteCaption(groupId: string) {
  const { d, g, r } = current(groupId);
  if (!g || !r) return;
  const brief = d.campaigns[g.campaignId].brief;
  const next = nextCaption(brief, platformsOf(d, g.destinationIds), r.cursor, r.hashtags);
  act((dd, c) => commitRevision(dd, c, groupId, { ...pickContent(r), caption: next.caption }, 'Rewrote caption', next.cursor));
}

/** Next prepared image (or video cover); keeps the caption. */
export function anotherImage(groupId: string) {
  const { d, g, r } = current(groupId);
  if (!g || !r) return;
  const next = nextImage(topicKeyOf(d.campaigns[g.campaignId].brief), g.format, r.cursor);
  act((dd, c) => commitRevision(dd, c, groupId, { ...pickContent(r), mediaIds: next.mediaIds, thumbnailMediaId: next.thumbnailMediaId }, 'New image', next.cursor));
}

/** Use an uploaded image (for video posts it becomes the cover image). */
export function applyUploadedImage(groupId: string, mediaId: string) {
  const { g, r } = current(groupId);
  if (!g || !r) return;
  const patch = formatNeedsVideo(g.format) ? { thumbnailMediaId: mediaId } : { mediaIds: [mediaId] };
  act((d, c) => commitRevision(d, c, groupId, { ...pickContent(r), ...patch, crop: { fit: 'fill', focalX: 50, focalY: 50 } }, 'Uploaded image'));
}

/** First problem that blocks approval, in plain language, or null. */
export function blockingProblem(groupId: string): string | null {
  const { d, g, r } = current(groupId);
  if (!g || !r) return 'This post no longer exists.';
  if (formatNeedsVideo(g.format) && !r.mediaIds.some((id) => d.media[id]?.kind === 'video')) return 'Add a sample video to preview YouTube.';
  const e = validateGroup(d, g, r).find((i) => i.level === 'error');
  return e ? e.message.replace(' (demo validation rule)', '') : null;
}

/**
 * Approve the exact current content and post it now or at `at`. Only destinations not already posted are sent.
 * Returns true on success.
 */
export async function approveAndPost(groupId: string, when: { now: true } | { now: false; at: string }): Promise<boolean> {
  let ids: string[] = [];
  try {
    ids = act((d, c) => {
      const g = d.groups[groupId];
      if (g.reviewState === 'draft' || g.reviewState === 'changes_requested') submitForReview(d, c, groupId);
      const times = when.now ? undefined : Object.fromEntries(g.destinationIds.map((id) => [id, when.at]));
      return approveGroup(
        d,
        c,
        groupId,
        { mode: when.now ? 'now' : 'schedule', times, displayTimezone: d.brand.timezone, expectedRevisionId: g.currentRevisionId },
        () => {
          const e = validateGroup(d, d.groups[groupId], d.revisions[d.groups[groupId].currentRevisionId]).find((i) => i.level === 'error');
          return e ? e.message : null;
        },
      );
    });
  } catch (e) {
    toast(e instanceof ReviewError ? e.message : 'The post could not be approved. Try again.', 'error');
    return false;
  }
  if (when.now) {
    const results = await Promise.all(ids.map((id) => publishDelivery(id, true)));
    const ok = results.filter((r) => r.ok).length;
    if (ok < results.length) toast(`${ok} of ${results.length} platforms posted. Open My Posts to review the rest.`, 'warning', { label: 'My Posts', href: '/posts?tab=scheduled' });
    else toast('Posted in preview.', 'success', { label: 'View in My Posts', href: '/posts?tab=posted' });
  } else {
    toast('Approved and scheduled.', 'success', { label: 'View in My Posts', href: '/posts?tab=scheduled' });
  }
  return true;
}

/** Cancel a scheduled post. The content is kept and moves back to Needs approval. */
export function cancelSchedule(groupId: string) {
  act((d, c) => {
    const g = d.groups[groupId];
    if (g) invalidateApproval(d, c, g, 'Schedule cancelled');
  });
  toast('Schedule cancelled. The post is kept under Needs approval.', 'info', { label: 'Needs approval', href: '/posts?tab=approval' });
}
