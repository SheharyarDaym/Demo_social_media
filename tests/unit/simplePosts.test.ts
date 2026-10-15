import { describe, expect, it } from 'vitest';
import { buildSeed, buildSimpleSeed } from '../../src/fixtures/seed';
import {
  addCreateLater,
  cardSpecs,
  createPost,
  parseCaptionText,
  pendingCreateLater,
  postRows,
  postState,
  runCreateLater,
  topicFromText,
} from '../../src/domain/simplePosts';
import { approveGroup, commitRevision, invalidateApproval, submitForReview, type Ctx } from '../../src/domain/ops';
import { beginPublish, completePublish } from '../../src/domain/publishing';
import { validateGroup } from '../../src/domain/validation';
import { pickContent } from '../../src/domain/util';

const T0 = new Date('2026-10-15T09:00:00Z');
const ctx = (h = 0): Ctx => ({ now: new Date(T0.getTime() + h * 3_600_000), actor: 'Administrator', role: 'admin' });

describe('simplified seed', () => {
  it('has exactly three examples: needs approval, scheduled, posted', () => {
    const d = buildSimpleSeed(T0, 'America/New_York');
    const statuses = postRows(d).map((r) => r.state.status).sort();
    expect(statuses).toEqual(['needs_approval', 'posted', 'scheduled']);
    expect(pendingCreateLater(d)).toHaveLength(0);
  });

  it('legacy (earlier demo) records map into the three simplified views without deleting anything', () => {
    const d = buildSeed(T0, 'UTC');
    const rows = postRows(d);
    expect(rows.length).toBeGreaterThan(5);
    const statuses = new Set(rows.map((r) => r.state.status));
    expect(statuses).toEqual(new Set(['needs_approval', 'scheduled', 'posted']));
    // The partially failed legacy campaign shows as scheduled with a time to review, not as posted.
    const take = rows.find((r) => r.campaign.title === 'Take time to prepare')!;
    expect(take.state.status).toBe('scheduled');
    expect(take.state.needsTimeReview).toBe(true);
    // Legacy recurring schedules are kept stored but are not create-later requests.
    expect(Object.keys(d.schedules)).toHaveLength(3);
    expect(pendingCreateLater(d)).toHaveLength(0);
  });
});

describe('same vs different posts', () => {
  it('same post shares one card and splits YouTube into its own video card', () => {
    expect(cardSpecs(['facebook', 'instagram', 'youtube'], 'same').map((c) => [c.platforms, c.format])).toEqual([
      [['facebook', 'instagram'], 'image'],
      [['youtube'], 'short_video'],
    ]);
  });

  it('different posts creates one card per platform', () => {
    expect(cardSpecs(['facebook', 'linkedin', 'snapchat'], 'different')).toHaveLength(3);
  });

  it('every generated card is valid and unapproved; the YouTube version uses a real video and the shared wording', () => {
    const d = buildSimpleSeed(T0, 'UTC');
    const c = createPost(d, ctx(), { text: 'Create a post about lifeguard training.', platforms: ['facebook', 'instagram', 'snapchat', 'tiktok', 'x', 'youtube'], mode: 'same' });
    const groups = c.groupIds.map((id) => d.groups[id]);
    for (const g of groups) {
      expect(g.reviewState).toBe('draft');
      expect(validateGroup(d, g, d.revisions[g.currentRevisionId]).filter((i) => i.level === 'error')).toEqual([]);
    }
    const [shared, yt] = groups.map((g) => d.revisions[g.currentRevisionId]);
    expect(d.media[yt.mediaIds[0]].kind).toBe('video');
    expect(yt.caption).toBe(shared.caption);
  });

  it('maps topics from free text, and keeps unknown wording in a safe template', () => {
    expect(topicFromText('Create a post about team development').topic).toBe('team');
    const custom = topicFromText('Create a post about our new parking area for Lifeguard-Pro.org.');
    expect(custom.topic).toBe('custom');
    expect(custom.customTopic).toBe('our new parking area');
  });
});

describe('caption text', () => {
  it('splits a trailing hashtag paragraph from the caption', () => {
    expect(parseCaptionText('Hello there.\n\n#One #Two')).toEqual({ caption: 'Hello there.', hashtags: ['#One', '#Two'] });
    expect(parseCaptionText('No tags here')).toEqual({ caption: 'No tags here', hashtags: [] });
  });
});

describe('approval rules in the simplified flow', () => {
  function scheduled() {
    const d = buildSimpleSeed(T0, 'UTC');
    const c = createPost(d, ctx(), { text: 'lifeguard training', platforms: ['facebook', 'instagram'], mode: 'same' });
    const gid = c.groupIds[0];
    submitForReview(d, ctx(), gid);
    const at = new Date(T0.getTime() + 3_600_000).toISOString();
    approveGroup(d, ctx(), gid, { mode: 'schedule', times: { 'dest-facebook': at, 'dest-instagram': at }, displayTimezone: 'UTC' }, () => null);
    return { d, gid };
  }

  it('editing a scheduled post moves it back to Needs approval and cancels the schedule', () => {
    const { d, gid } = scheduled();
    expect(postState(d, d.groups[gid]).status).toBe('scheduled');
    commitRevision(d, ctx(0.1), gid, { ...pickContent(d.revisions[d.groups[gid].currentRevisionId]), caption: 'Changed' }, 'Edited');
    expect(postState(d, d.groups[gid]).status).toBe('needs_approval');
    expect(Object.values(d.deliveries).filter((x) => x.groupId === gid).every((x) => x.status === 'cancelled')).toBe(true);
  });

  it('cancelling a schedule keeps the content under Needs approval', () => {
    const { d, gid } = scheduled();
    const caption = d.revisions[d.groups[gid].currentRevisionId].caption;
    invalidateApproval(d, ctx(0.2), d.groups[gid], 'Schedule cancelled');
    expect(postState(d, d.groups[gid]).status).toBe('needs_approval');
    expect(d.revisions[d.groups[gid].currentRevisionId].caption).toBe(caption);
  });

  it('a posted card is reported as posted once every platform has a preview receipt', () => {
    const { d, gid } = scheduled();
    for (const del of Object.values(d.deliveries).filter((x) => x.groupId === gid)) {
      beginPublish(d, ctx(2), del.id, { manual: false });
      completePublish(d, ctx(2), del.id);
    }
    expect(postState(d, d.groups[gid]).status).toBe('posted');
  });
});

describe('create later', () => {
  it('runs once, creates an unapproved post and leaves the list', () => {
    const d = buildSimpleSeed(T0, 'UTC');
    const s = addCreateLater(d, ctx(), new Date(T0.getTime() + 3_600_000).toISOString(), { text: 'pool safety', platforms: ['facebook'], mode: 'same' }, 'UTC');
    expect(pendingCreateLater(d)).toHaveLength(1);
    const c = runCreateLater(d, ctx(1), s.id, `${s.id}@x`)!;
    expect(c).toBeTruthy();
    expect(d.groups[c.groupIds[0]].reviewState).toBe('draft');
    expect(Object.values(d.deliveries).filter((x) => x.campaignId === c.id)).toHaveLength(0);
    expect(pendingCreateLater(d)).toHaveLength(0);
    expect(runCreateLater(d, ctx(1), s.id, `${s.id}@x`)).toBeNull();
  });
});
