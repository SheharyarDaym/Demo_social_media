import { describe, expect, it } from 'vitest';
import { buildSeed, DEST_ID } from '../../src/fixtures/seed';
import {
  approveGroup,
  commitRevision,
  createCampaign,
  detachDestination,
  latestDeliveries,
  moveDestination,
  removeDestination,
  rescheduleDelivery,
  submitForReview,
  requestChanges,
  ReviewError,
  type Ctx,
} from '../../src/domain/ops';
import { beginPublish, checkStatus, completePublish, dueDeliveries, markMissedDeliveries, publishNowOverride } from '../../src/domain/publishing';
import { guardDelivery, validateGroup } from '../../src/domain/validation';
import { contentHashOf, pickContent, renderCaption } from '../../src/domain/util';
import { generateGroups, nextCaption, nextImage, voiceFor } from '../../src/services/fixtureEngine';
import { contentFromGenerated } from '../../src/domain/generationRuns';
import type { AppData, Brief, Platform } from '../../src/domain/types';

const T0 = new Date('2026-10-15T09:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const admin = (h = 0): Ctx => ({ now: at(h), actor: 'Administrator', role: 'admin' });
const editor = (h = 0): Ctx => ({ now: at(h), actor: 'Content editor', role: 'editor' });

const brief: Brief = {
  topic: 'training',
  customTopic: '',
  visualFamily: 'training',
  instructions: '',
  objective: 'awareness',
  audience: 'Aquatic teams',
  tone: 'professional',
  length: 'medium',
  cta: 'Explore training options',
};

function fresh(): AppData {
  return buildSeed(T0, 'America/New_York');
}

function make(d: AppData, groups: Platform[][], formats?: ('image' | 'short_video' | 'story' | 'carousel' | 'video')[]) {
  const specs = groups.map((ps, i) => ({ destinationIds: ps.map(DEST_ID), platforms: ps, format: formats?.[i] ?? ('image' as const) }));
  const { contents, cursors } = generateGroups(brief, specs, d.cursors);
  d.cursors = cursors;
  return createCampaign(d, editor(), {
    title: 'Test campaign',
    brief,
    mode: groups.length === 1 ? 'same' : 'custom',
    groups: specs.map((s, i) => ({ destinationIds: s.destinationIds, format: s.format, content: contentFromGenerated(contents[i], d.brand.website), cursor: contents[i].cursor })),
  });
}

const valid = (d: AppData, gid: string) => () => {
  const g = d.groups[gid];
  const e = validateGroup(d, g, d.revisions[g.currentRevisionId]).filter((i) => i.level === 'error');
  return e.length ? e[0].message : null;
};

describe('seed workspace', () => {
  it('is deterministic and covers the required states', () => {
    const a = fresh();
    const b = fresh();
    expect(Object.keys(a.campaigns)).toEqual(Object.keys(b.campaigns));
    expect(Object.keys(a.campaigns)).toHaveLength(10);
    const states = Object.values(a.groups).map((g) => g.reviewState);
    expect(states).toContain('in_review');
    expect(states).toContain('draft');
    expect(states).toContain('changes_requested');
    expect(states).toContain('approved');
    const statuses = Object.values(a.deliveries).map((x) => x.status);
    expect(statuses).toContain('published_preview');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('scheduled');
    expect(Object.keys(a.schedules)).toHaveLength(3);
  });

  it('seeded failed campaign has LinkedIn published and only X failed', () => {
    const d = fresh();
    const c = Object.values(d.campaigns).find((x) => x.title === 'Take time to prepare')!;
    const dels = latestDeliveries(d, c.groupIds[0]);
    const li = dels.find((x) => x.destinationId === DEST_ID('linkedin'))!;
    const x = dels.find((x) => x.destinationId === DEST_ID('x'))!;
    expect(li.status).toBe('published_preview');
    expect(x.status).toBe('failed');
  });
});

describe('content groups', () => {
  it('same content creates one shared group with identical source content for both destinations', () => {
    const d = fresh();
    const c = make(d, [['facebook', 'instagram']]);
    expect(c.groupIds).toHaveLength(1);
    expect(d.groups[c.groupIds[0]].destinationIds).toEqual([DEST_ID('facebook'), DEST_ID('instagram')]);
  });

  it('Instagram + LinkedIn shared with X separate gives two groups and distinct X copy', () => {
    const d = fresh();
    const c = make(d, [['instagram', 'linkedin'], ['x']]);
    const [a, b] = c.groupIds.map((id) => d.revisions[d.groups[id].currentRevisionId]);
    expect(c.groupIds).toHaveLength(2);
    expect(a.caption).not.toEqual(b.caption);
    expect(voiceFor(['instagram', 'linkedin'])).toBe('shared_ig_li');
  });

  it('a destination appears exactly once per campaign when moved between groups', () => {
    const d = fresh();
    const c = make(d, [['instagram', 'linkedin'], ['x']]);
    const [a, b] = c.groupIds;
    moveDestination(d, editor(), DEST_ID('linkedin'), b);
    const all = d.campaigns[c.id].groupIds.flatMap((id) => d.groups[id].destinationIds);
    expect(all.filter((x) => x === DEST_ID('linkedin'))).toHaveLength(1);
    expect(d.groups[a].destinationIds).toEqual([DEST_ID('instagram')]);
  });

  it('detaching clones into an independent draft without inheriting approval', () => {
    const d = fresh();
    const c = make(d, [['instagram', 'linkedin']]);
    const gid = c.groupIds[0];
    submitForReview(d, editor(), gid);
    approveGroup(d, admin(), gid, { mode: 'only', displayTimezone: 'UTC' }, valid(d, gid));
    const clone = detachDestination(d, editor(), gid, DEST_ID('linkedin'));
    expect(clone.id).not.toBe(gid);
    expect(clone.reviewState).toBe('draft');
    expect(clone.currentApprovalId).toBeNull();
    // Source destination set changed, so its approval is invalidated.
    expect(d.groups[gid].reviewState).toBe('in_review');
    // Editing the clone leaves the original untouched.
    const before = d.revisions[d.groups[gid].currentRevisionId].caption;
    commitRevision(d, editor(), clone.id, { ...pickContent(d.revisions[clone.currentRevisionId]), caption: 'Only for LinkedIn' }, 'Edited');
    expect(d.revisions[d.groups[gid].currentRevisionId].caption).toBe(before);
  });

  it('YouTube in an image group is flagged with a split fix, never accepted as an image post', () => {
    const d = fresh();
    const c = make(d, [['facebook', 'youtube']]);
    const g = d.groups[c.groupIds[0]];
    const issues = validateGroup(d, g, d.revisions[g.currentRevisionId]);
    const yt = issues.find((i) => i.message.startsWith('YouTube needs a video'));
    expect(yt?.fix?.kind).toBe('split_video');
  });

  it('X demo budget blocks overlong shared copy without truncating it', () => {
    const d = fresh();
    const c = make(d, [['facebook', 'x']]);
    const g = d.groups[c.groupIds[0]];
    const long = 'A'.repeat(300);
    commitRevision(d, editor(), g.id, { ...pickContent(d.revisions[g.currentRevisionId]), caption: long }, 'Edited');
    const rev = d.revisions[d.groups[g.id].currentRevisionId];
    expect(rev.caption).toBe(long);
    expect(validateGroup(d, g, rev).some((i) => i.message.includes('X caption'))).toBe(true);
  });

  it('submission is blocked when no destinations or media are present', () => {
    const d = fresh();
    const c = make(d, [['instagram']]);
    const g = d.groups[c.groupIds[0]];
    const issues = validateGroup(d, { ...g, destinationIds: [] }, { ...d.revisions[g.currentRevisionId], mediaIds: [] });
    expect(issues.some((i) => i.message.includes('at least one destination'))).toBe(true);
    expect(issues.some((i) => i.message.includes('needs an image'))).toBe(true);
  });
});

describe('generation fixtures', () => {
  it('caption regeneration changes text and keeps cycling three variants', () => {
    const d = fresh();
    const c = make(d, [['facebook']]);
    const r = d.revisions[d.groups[c.groupIds[0]].currentRevisionId];
    const seen = new Set<string>();
    let cursor = r.cursor;
    for (let i = 0; i < 3; i++) {
      const n = nextCaption(brief, ['facebook'], cursor, r.hashtags);
      seen.add(n.caption);
      cursor = n.cursor;
    }
    expect(seen.size).toBe(3);
  });

  it('image regeneration yields three distinct local visuals', () => {
    const d = fresh();
    const c = make(d, [['instagram']]);
    let cursor = d.revisions[d.groups[c.groupIds[0]].currentRevisionId].cursor;
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const n = nextImage('training', 'image', cursor);
      ids.add(n.mediaIds[0]);
      cursor = n.cursor;
      expect(d.media[n.mediaIds[0]]).toBeDefined();
    }
    expect(ids.size).toBe(3);
  });

  it('tone and length visibly change the caption', () => {
    const a = generateGroups({ ...brief, tone: 'professional', length: 'short' }, [{ destinationIds: ['x'], platforms: ['facebook'], format: 'image' }], { caption: {}, hashtag: {}, image: {} });
    const b = generateGroups({ ...brief, tone: 'energetic', length: 'long' }, [{ destinationIds: ['x'], platforms: ['facebook'], format: 'image' }], { caption: {}, hashtag: {}, image: {} });
    expect(a.contents[0].caption).not.toEqual(b.contents[0].caption);
    expect(b.contents[0].caption.length).toBeGreaterThan(a.contents[0].caption.length);
  });

  it('hashtags are appended exactly once', () => {
    expect(renderCaption('Hello #WaterSafety', ['#WaterSafety', '#LifeguardPro', '#lifeguardpro'])).toBe('Hello #WaterSafety\n\n#LifeguardPro');
  });
});

describe('approval and publication', () => {
  function approved(mode: 'now' | 'schedule' = 'now') {
    const d = fresh();
    const c = make(d, [['facebook', 'instagram']]);
    const gid = c.groupIds[0];
    submitForReview(d, editor(), gid);
    const ids = approveGroup(
      d,
      admin(),
      gid,
      { mode, displayTimezone: 'UTC', times: mode === 'schedule' ? { [DEST_ID('facebook')]: at(2).toISOString(), [DEST_ID('instagram')]: at(2).toISOString() } : undefined },
      valid(d, gid),
    );
    return { d, gid, ids };
  }

  it('Editor cannot approve', () => {
    const d = fresh();
    const c = make(d, [['facebook']]);
    submitForReview(d, editor(), c.groupIds[0]);
    expect(() => approveGroup(d, editor(), c.groupIds[0], { mode: 'only', displayTimezone: 'UTC' }, () => null)).toThrow(ReviewError);
  });

  it('approve only never creates a delivery', () => {
    const d = fresh();
    const c = make(d, [['facebook']]);
    submitForReview(d, editor(), c.groupIds[0]);
    const ids = approveGroup(d, admin(), c.groupIds[0], { mode: 'only', displayTimezone: 'UTC' }, valid(d, c.groupIds[0]));
    expect(ids).toEqual([]);
    expect(d.groups[c.groupIds[0]].reviewState).toBe('approved');
  });

  it('request changes records the note and publishes nothing', () => {
    const d = fresh();
    const c = make(d, [['facebook']]);
    const gid = c.groupIds[0];
    submitForReview(d, editor(), gid);
    requestChanges(d, admin(), gid, 'Shorter please');
    expect(d.groups[gid].reviewState).toBe('changes_requested');
    expect(d.groups[gid].reviewNote).toBe('Shorter please');
    expect(Object.values(d.deliveries).filter((x) => x.groupId === gid)).toHaveLength(0);
  });

  it('approving an unseen newer revision is refused', () => {
    const d = fresh();
    const c = make(d, [['facebook']]);
    const gid = c.groupIds[0];
    submitForReview(d, editor(), gid);
    const seen = d.groups[gid].currentRevisionId;
    commitRevision(d, editor(), gid, { ...pickContent(d.revisions[seen]), caption: 'Changed while reviewing' }, 'Edited');
    expect(() => approveGroup(d, admin(), gid, { mode: 'only', displayTimezone: 'UTC', expectedRevisionId: seen }, valid(d, gid))).toThrow(/newer revision/);
  });

  it('publish now sends only to listed destinations, once each, even with repeated clicks', () => {
    const { d, ids } = approved('now');
    for (const id of ids) {
      expect(beginPublish(d, admin(), id, { manual: true })).toEqual({ started: true });
      expect(beginPublish(d, admin(), id, { manual: true }).started).toBe(false); // double click
      completePublish(d, admin(), id);
      completePublish(d, admin(), id); // repeated completion is a no-op
    }
    const published = Object.values(d.deliveries).filter((x) => ids.includes(x.id) && x.status === 'published_preview');
    expect(published).toHaveLength(2);
    expect(new Set(published.map((p) => p.receipt!.id)).size).toBe(2);
  });

  it('editing approved content invalidates approval and suspends pending sends', () => {
    const { d, gid, ids } = approved('schedule');
    const rev = d.revisions[d.groups[gid].currentRevisionId];
    commitRevision(d, editor(1), gid, { ...pickContent(rev), caption: rev.caption + ' Edited.' }, 'Edited');
    expect(d.groups[gid].reviewState).toBe('in_review');
    expect(d.groups[gid].changedAfterApproval).toBe(true);
    for (const id of ids) expect(d.deliveries[id].status).toBe('cancelled');
    expect(dueDeliveries(d, at(5)).filter((x) => ids.includes(x.id))).toHaveLength(0);
  });

  it('guard rejects a delivery whose content no longer matches the approved hash', () => {
    const { d, gid, ids } = approved('now');
    // Tamper with the revision directly (bypassing ops) — the guard must still refuse.
    const rev = d.revisions[d.groups[gid].currentRevisionId];
    rev.caption = 'tampered';
    expect(guardDelivery(d, d.deliveries[ids[0]], { now: at(0), manual: true, role: 'admin' }).ok).toBe(false);
    expect(contentHashOf(pickContent(rev))).not.toBe(d.approvals[d.groups[gid].currentApprovalId!].contentHash);
  });

  it('rescheduling invalidates approval; scheduled send waits for the time', () => {
    const { d, gid, ids } = approved('schedule');
    expect(beginPublish(d, admin(), ids[0], { manual: false }).started).toBe(false); // too early
    const mine = (h: number) => dueDeliveries(d, at(h)).filter((x) => ids.includes(x.id));
    expect(mine(1)).toHaveLength(0);
    expect(mine(2)).toHaveLength(2);
    rescheduleDelivery(d, admin(1), ids[0], at(6).toISOString());
    expect(d.groups[gid].reviewState).toBe('in_review');
    expect(mine(7)).toHaveLength(0);
  });

  it('a failed destination does not affect the successful one and retry targets it only', () => {
    const { d, ids } = approved('now');
    const [fb, ig] = ids;
    d.preview.failure = { kind: 'clear', destinationId: DEST_ID('instagram') };
    for (const id of ids) {
      beginPublish(d, admin(), id, { manual: true });
      completePublish(d, admin(), id);
    }
    expect(d.deliveries[fb].status).toBe('published_preview');
    expect(d.deliveries[ig].status).toBe('failed');
    const fbReceipt = d.deliveries[fb].receipt!.id;
    beginPublish(d, admin(1), ig, { manual: true });
    completePublish(d, admin(1), ig);
    expect(d.deliveries[ig].status).toBe('published_preview');
    expect(d.deliveries[fb].receipt!.id).toBe(fbReceipt);
    expect(d.deliveries[ig].attempts).toBe(2);
  });

  it('ambiguous timeouts resolve by status check, not by resending', () => {
    const { d, ids } = approved('now');
    d.preview.failure = { kind: 'ambiguous', destinationId: 'any' };
    beginPublish(d, admin(), ids[0], { manual: true });
    completePublish(d, admin(), ids[0]);
    expect(d.deliveries[ids[0]].status).toBe('processing');
    expect(beginPublish(d, admin(), ids[0], { manual: true }).started).toBe(false);
    expect(checkStatus(d, admin(), ids[0])).toBe('published');
    expect(d.deliveries[ids[0]].attempts).toBe(1);
  });

  it('disconnected destinations block sending; reconnecting alone does not release an overdue post', () => {
    const { d, ids } = approved('schedule');
    d.destinations[DEST_ID('facebook')].connection = 'disconnected';
    const fb = ids.find((id) => d.deliveries[id].destinationId === DEST_ID('facebook'))!;
    beginPublish(d, admin(3), fb, { manual: false });
    expect(d.deliveries[fb].status).toBe('blocked');
    d.destinations[DEST_ID('facebook')].connection = 'preview_connected';
    expect(dueDeliveries(d, at(4)).map((x) => x.id)).not.toContain(fb);
    // Explicit admin decision publishes it.
    const nid = publishNowOverride(d, admin(4), fb)!;
    expect(beginPublish(d, admin(4), nid, { manual: true }).started).toBe(true);
  });

  it('publications missed while the app was closed are blocked, not sent', () => {
    const { d, ids } = approved('schedule');
    markMissedDeliveries(d, admin(10));
    for (const id of ids) expect(d.deliveries[id]).toMatchObject({ status: 'blocked', blockedReason: 'Scheduled time missed' });
    expect(dueDeliveries(d, at(10))).toHaveLength(0);
  });

  it('removing a destination from an approved group invalidates approval', () => {
    const { d, gid } = approved('schedule');
    removeDestination(d, admin(), d.groups[gid].campaignId, DEST_ID('instagram'));
    expect(d.groups[gid].reviewState).toBe('in_review');
  });
});
