// Browser-local scheduler for the simplified demo. It runs only while the preview is open.
//
// - "Create later" draft requests run once at their time and create an unapproved post.
// - Approved scheduled posts are sent when their time arrives (the publishing guard re-checks approval).
// - Anything that came due while the preview was closed is NOT run automatically: draft requests offer
//   "Create draft now", and overdue posts ask the user to "Review posting time".
// - One tab acts as the scheduler (Web Locks, with a localStorage lease fallback), and every run/send is
//   claimed in IndexedDB so two open tabs never duplicate work.

import { act, bumpTick, now, publishDelivery, toast, useStore } from '../store/store';
import { dueDeliveries, markMissedDeliveries } from '../domain/publishing';
import { pendingCreateLater, runCreateLater } from '../domain/simplePosts';
import { occurrenceKey } from '../domain/recurrence';
import * as db from '../persistence/db';
import { iso } from '../domain/ops';

const TICK_MS = 15_000;
/** More real time than this between ticks (sleep, closed laptop) is treated like the preview being closed. */
const RESUME_GAP_MS = 10 * 60_000;

let isLeader = false;
let lastRealTick = Date.now();
let ticking = false;

async function safeClaim(key: string): Promise<boolean> {
  try {
    return await db.claim(key);
  } catch {
    return true; // storage unavailable: in-memory guards still apply
  }
}

function becomeLeaderViaLease() {
  const KEY = `${db.PREFS_PREFIX}scheduler-lease`;
  const me = Math.random().toString(36).slice(2);
  const tryTake = () => {
    try {
      const raw = localStorage.getItem(KEY);
      const lease = raw ? (JSON.parse(raw) as { id: string; until: number }) : null;
      isLeader = !lease || lease.until < Date.now() || lease.id === me;
      if (isLeader) localStorage.setItem(KEY, JSON.stringify({ id: me, until: Date.now() + TICK_MS * 2 }));
    } catch {
      isLeader = true;
    }
  };
  tryTake();
  setInterval(tryTake, TICK_MS);
}

function electLeader() {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks?.request) {
    void locks.request('lgp-social-studio:scheduler', () => {
      isLeader = true;
      void tick();
      return new Promise<void>(() => {
        /* hold the lock while this tab is open */
      });
    });
  } else {
    becomeLeaderViaLease();
  }
}

/** Work that came due while the preview was closed waits for the user. */
function detectMissed() {
  const n = now();
  const missedLater = pendingCreateLater(useStore.getState().data)
    .filter((s) => new Date(s.startsAtUTC).getTime() <= n.getTime())
    .map((s) => s.id);
  act((d, c) => {
    markMissedDeliveries(d, c);
    d.preview.lastActiveAtUTC = iso(n);
  });
  useStore.setState({ missedLater });
}

/** Run a draft request now (on time, or when the user chooses "Create draft now"). */
export async function runDraftRequest(scheduleId: string): Promise<string | null> {
  const s = useStore.getState().data.schedules[scheduleId];
  if (!s?.createLater || !s.enabled) return null;
  const key = occurrenceKey(scheduleId, s.startsAtUTC);
  if (!(await safeClaim(`occ:${key}`))) return null;
  const campaign = act((d, c) => runCreateLater(d, c, scheduleId, key));
  useStore.setState((st) => ({ missedLater: st.missedLater.filter((id) => id !== scheduleId) }));
  return campaign?.id ?? null;
}

export async function tick() {
  if (ticking || !useStore.getState().ready) return;
  const realNow = Date.now();
  if (realNow - lastRealTick > RESUME_GAP_MS) {
    lastRealTick = realNow;
    detectMissed();
    return;
  }
  lastRealTick = realNow;
  bumpTick();
  if (!isLeader) return;
  ticking = true;
  try {
    const n = now();
    const { data, missedLater } = useStore.getState();
    for (const s of pendingCreateLater(data)) {
      if (missedLater.includes(s.id) || new Date(s.startsAtUTC).getTime() > n.getTime()) continue;
      const id = await runDraftRequest(s.id);
      if (id) toast(`Your draft “${s.name}” is ready to review.`, 'success', { label: 'My Posts', href: '/posts' });
    }
    for (const del of dueDeliveries(useStore.getState().data, n)) void publishDelivery(del.id, false);
    act((d) => {
      d.preview.lastActiveAtUTC = iso(n);
    });
  } finally {
    ticking = false;
  }
}

export function startScheduler(): () => void {
  detectMissed();
  electLeader();
  const timer = setInterval(() => void tick(), TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick();
  };
  const onFocus = () => void tick();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
  };
}
