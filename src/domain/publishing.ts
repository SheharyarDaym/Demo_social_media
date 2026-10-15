// Mock publication lifecycle. Nothing here talks to a network: "publishing" writes a local preview receipt.
// Every send re-runs the guard against the authoritative store state at execution time.

import { DEMO_LIMITS, PLATFORM_LABEL } from './rules';
import type { AppData, Delivery, FailureKind } from './types';
import { guardDelivery } from './validation';
import { iso, log, notify, type Ctx } from './ops';
import { uid } from './util';

function label(d: AppData, del: Delivery) {
  const p = d.destinations[del.destinationId]?.platform;
  return p ? PLATFORM_LABEL[p] : 'Destination';
}

function title(d: AppData, del: Delivery) {
  return d.campaigns[del.campaignId]?.title ?? 'Campaign';
}

export type BeginResult = { started: true } | { started: false; reason: string };

/**
 * Move a delivery into `publishing` if (and only if) the guard passes. Synchronous so a second click or a
 * repeated tick sees `publishing` and does nothing (single delivery per approved intent).
 */
export function beginPublish(d: AppData, ctx: Ctx, deliveryId: string, opts: { manual: boolean }): BeginResult {
  const del = d.deliveries[deliveryId];
  if (!del) return { started: false, reason: 'Delivery not found.' };
  if (del.status === 'publishing' || del.status === 'published_preview' || del.status === 'cancelled') {
    return { started: false, reason: del.status === 'publishing' ? 'Already sending.' : 'Nothing to send.' };
  }
  if (del.status === 'processing') return { started: false, reason: 'Status unknown — use Check status instead of sending again.' };
  if (del.status === 'blocked' && !opts.manual) return { started: false, reason: del.blockedReason };
  if (del.status === 'failed' && del.error?.kind === 'reconnect' && d.destinations[del.destinationId]?.connection !== 'preview_connected') {
    return { started: false, reason: 'Reconnect the destination before retrying.' };
  }
  // Idempotency: if the mock platform already holds a receipt for this key, record success instead of resending.
  const prior = d.mockPlatformLedger[del.deliveryKey];
  if (prior) {
    markPublished(d, ctx, del, prior);
    return { started: false, reason: 'Already published in preview.' };
  }
  const g = guardDelivery(d, del, { now: ctx.now, manual: opts.manual, role: ctx.role });
  if (!g.ok) {
    if (g.kind === 'time') return { started: false, reason: g.reason };
    if (g.kind === 'connection' || g.kind === 'reconnect') {
      del.status = 'blocked';
      del.blockedReason = g.reason;
      del.updatedAt = iso(ctx.now);
      log(d, ctx, 'delivery.blocked', del.id, `${label(d, del)} publication of “${title(d, del)}” blocked: destination not connected`);
      notify(d, ctx, 'Publication blocked', `${label(d, del)}: ${g.reason}`, '/library?tab=attention', 'warning');
    } else if (g.kind === 'approval' || g.kind === 'validation') {
      del.status = 'blocked';
      del.blockedReason = g.reason;
      del.updatedAt = iso(ctx.now);
    }
    return { started: false, reason: g.reason };
  }
  del.status = 'publishing';
  del.attempts += 1;
  del.error = null;
  del.nextRetryAt = null;
  del.blockedReason = '';
  del.updatedAt = iso(ctx.now);
  return { started: true };
}

function markPublished(d: AppData, ctx: Ctx, del: Delivery, receiptId: string) {
  del.status = 'published_preview';
  del.receipt = { id: receiptId, at: iso(ctx.now) };
  del.error = null;
  del.nextRetryAt = null;
  del.updatedAt = iso(ctx.now);
  log(d, ctx, 'delivery.published', del.id, `Published in preview: ${label(d, del)} — “${title(d, del)}”`);
  notify(d, ctx, 'Published in preview', `${label(d, del)} — ${title(d, del)}`, `/published/${del.id}`, 'success');
}

/** Consume the one-shot simulated failure if it targets this destination. */
export function takeFailure(d: AppData, destinationId: string): FailureKind {
  const f = d.preview.failure;
  if (f.kind === 'none') return 'none';
  if (f.destinationId !== 'any' && f.destinationId !== destinationId) return 'none';
  d.preview.failure = { kind: 'none', destinationId: 'any' };
  return f.kind;
}

/** Finish a send that `beginPublish` started. */
export function completePublish(d: AppData, ctx: Ctx, deliveryId: string) {
  const del = d.deliveries[deliveryId];
  if (!del || del.status !== 'publishing') return;
  const outcome = takeFailure(d, del.destinationId);
  const receiptId = `preview-receipt-${uid('r').slice(2)}`;
  if (outcome === 'none') {
    d.mockPlatformLedger[del.deliveryKey] = receiptId;
    markPublished(d, ctx, del, receiptId);
    return;
  }
  del.updatedAt = iso(ctx.now);
  if (outcome === 'ambiguous') {
    // The mock platform did receive it, but the response timed out: never blindly resend.
    d.mockPlatformLedger[del.deliveryKey] = receiptId;
    del.status = 'processing';
    del.error = { kind: 'ambiguous', message: 'Needs status check — the simulated response timed out.' };
    log(d, ctx, 'delivery.ambiguous', del.id, `${label(d, del)} response timed out for “${title(d, del)}” — needs status check`);
    notify(d, ctx, 'Needs status check', `${label(d, del)} — ${title(d, del)}`, '/library?tab=attention', 'warning');
    return;
  }
  if (outcome === 'reconnect') {
    const dest = d.destinations[del.destinationId];
    if (dest) dest.connection = 'reconnect_required';
    del.status = 'failed';
    del.error = { kind: 'reconnect', message: 'Simulated permission error: reconnect this preview destination, then retry.' };
  } else if (outcome === 'transient') {
    del.status = 'failed';
    const delayMin = DEMO_LIMITS.retryDelaysMin[Math.min(del.attempts - 1, DEMO_LIMITS.retryDelaysMin.length - 1)];
    const canAuto = del.attempts < del.maxAttempts;
    del.nextRetryAt = canAuto ? iso(new Date(ctx.now.getTime() + delayMin * 60_000)) : null;
    del.error = {
      kind: 'transient',
      message: canAuto
        ? `Simulated temporary failure. Automatic retry in ${delayMin} minutes (attempt ${del.attempts} of ${del.maxAttempts}).`
        : `Simulated temporary failure. Automatic retries used (${del.maxAttempts}). Retry manually when ready.`,
    };
  } else {
    del.status = 'failed';
    del.error = { kind: 'clear', message: 'Simulated publication failure. Other destinations are unaffected. Retry this destination when ready.' };
  }
  log(d, ctx, 'delivery.failed', del.id, `${label(d, del)} publication failed in preview for “${title(d, del)}”`);
  notify(d, ctx, 'Publication failed', `${label(d, del)} — ${title(d, del)}`, '/library?tab=attention', 'error');
}

/** Resolve an ambiguous timeout by asking the mock platform ledger, never by sending again. */
export function checkStatus(d: AppData, ctx: Ctx, deliveryId: string): 'published' | 'not_found' {
  const del = d.deliveries[deliveryId];
  if (!del) return 'not_found';
  const receipt = d.mockPlatformLedger[del.deliveryKey];
  if (receipt) {
    markPublished(d, ctx, del, receipt);
    return 'published';
  }
  del.status = 'failed';
  del.error = { kind: 'clear', message: 'The preview platform has no record of this post. Retry is safe.' };
  return 'not_found';
}

/**
 * Admin explicitly publishes a blocked/missed delivery now. The approval must still be valid for this exact
 * revision; a new "now" intent is recorded in the approval snapshot and the old delivery is closed.
 */
export function publishNowOverride(d: AppData, ctx: Ctx, deliveryId: string): string | null {
  if (ctx.role !== 'admin') return null;
  const del = d.deliveries[deliveryId];
  if (!del) return null;
  const ap = d.approvals[del.approvalId];
  const g = d.groups[del.groupId];
  if (!ap || ap.invalidatedAt || !g || g.currentApprovalId !== ap.id || g.currentRevisionId !== del.revisionId) return null;
  const intentId = uid('int');
  ap.intents.push({
    id: intentId,
    destinationId: del.destinationId,
    revisionId: del.revisionId,
    mode: 'now',
    scheduledAtUTC: iso(ctx.now),
    displayTimezone: ap.intents[0]?.displayTimezone ?? 'UTC',
  });
  del.status = 'cancelled';
  del.blockedReason = 'Replaced by an administrator’s Publish now';
  del.updatedAt = iso(ctx.now);
  const id = uid('dlv');
  d.deliveries[id] = {
    ...structuredClone(del),
    id,
    intentId,
    deliveryKey: [del.campaignId, del.groupId, del.revisionId, del.destinationId, intentId].join('|'),
    status: 'scheduled',
    scheduledAtUTC: iso(ctx.now),
    attempts: 0,
    nextRetryAt: null,
    receipt: null,
    error: null,
    blockedReason: '',
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
  };
  return id;
}

/** Deliveries the scheduler should attempt now. */
export function dueDeliveries(d: AppData, now: Date): Delivery[] {
  const t = now.getTime();
  return Object.values(d.deliveries).filter((del) => {
    if (del.status === 'scheduled') return new Date(del.scheduledAtUTC).getTime() <= t;
    if (del.status === 'failed' && del.error?.kind === 'transient' && del.nextRetryAt) return new Date(del.nextRetryAt).getTime() <= t;
    return false;
  });
}

/**
 * On reopening, approved publications whose time passed while the app was closed are not sent automatically.
 * They become blocked with `Scheduled time missed` and need Publish now / Reschedule / Cancel.
 */
export function markMissedDeliveries(d: AppData, ctx: Ctx): number {
  let n = 0;
  for (const del of Object.values(d.deliveries)) {
    if (del.status === 'scheduled' && new Date(del.scheduledAtUTC).getTime() <= ctx.now.getTime()) {
      del.status = 'blocked';
      del.blockedReason = 'Scheduled time missed';
      del.updatedAt = iso(ctx.now);
      n++;
    }
  }
  if (n) {
    log(d, ctx, 'delivery.missed', 'scheduler', `${n} scheduled publication${n === 1 ? '' : 's'} missed while the app was closed`);
    notify(d, ctx, 'Scheduled time missed', `${n} publication${n === 1 ? '' : 's'} need a decision: Publish now, Reschedule or Cancel.`, '/library?tab=attention', 'warning');
  }
  return n;
}
