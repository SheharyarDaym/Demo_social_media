import { create } from 'zustand';
import type { AppData, Role } from '../domain/types';
import { actorName, type Ctx } from '../domain/ops';
import { buildSimpleSeed, SCHEMA_VERSION, SEED_VERSION } from '../fixtures/seed';
import { browserZone } from '../domain/recurrence';
import * as db from '../persistence/db';
import { beginPublish, checkStatus, completePublish } from '../domain/publishing';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  action?: { label: string; href: string };
}

interface StoreState {
  ready: boolean;
  loadError: string | null;
  data: AppData;
  storageError: string | null;
  /** Create-later requests whose time passed while the preview was closed (offer “Create draft now”). */
  missedLater: string[];
  toasts: Toast[];
  /** Bumped by the clock ticker so time-derived UI refreshes. */
  tick: number;
  /** Delivery ids currently being sent from this tab (double-click/tick guard). */
  inflight: Record<string, true>;
}

export const TAB_ID = Math.random().toString(36).slice(2);
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lgp-social-studio:v1') : null;

export const useStore = create<StoreState>(() => ({
  ready: false,
  loadError: null,
  data: null as unknown as AppData,
  storageError: null,
  missedLater: [],
  toasts: [],
  tick: 0,
  inflight: {},
}));

const get = useStore.getState;
const set = useStore.setState;

export function now(): Date {
  const d = get().data;
  return new Date(Date.now() + (d?.preview.clockOffsetMs ?? 0));
}

export function ctx(): Ctx {
  const role: Role = get().data.preview.role;
  return { now: now(), actor: actorName(role), role };
}

// ---------------------------------------------------------------- persistence

let savePending = false;
let saveQueued = false;
let saving: Promise<void> | null = null;

/** Persist promptly: coalesce changes made in the same tick, and serialize writes. */
function scheduleSave() {
  savePending = true;
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(() => {
    saveQueued = false;
    void flushSave();
  });
}

export async function flushSave(): Promise<void> {
  if (saving) {
    await saving;
    if (!savePending) return;
  }
  if (!savePending) return;
  savePending = false;
  saving = (async () => {
    try {
      await db.saveState(get().data);
      if (get().storageError) set({ storageError: null });
      channel?.postMessage({ type: 'saved', from: TAB_ID });
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
      set({ storageError: quota ? 'Changes could not be saved locally: browser storage is full.' : 'Changes could not be saved locally.' });
    }
  })();
  try {
    await saving;
  } finally {
    saving = null;
  }
  if (savePending) await flushSave();
}

channel?.addEventListener('message', async (ev: MessageEvent) => {
  if (ev.data?.type === 'saved' && ev.data.from !== TAB_ID && !savePending) {
    try {
      const fresh = await db.loadState<AppData>();
      if (fresh && fresh.schemaVersion === SCHEMA_VERSION) set({ data: fresh });
    } catch {
      /* keep current session */
    }
  }
  if (ev.data?.type === 'reset' && ev.data.from !== TAB_ID) window.location.reload();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushSave());
}

// ---------------------------------------------------------------- core mutation

/** Clone state, apply an op, commit, and persist. Errors thrown by the op leave state untouched. */
export function act<T>(fn: (d: AppData, c: Ctx) => T): T {
  const draft = structuredClone(get().data);
  const result = fn(draft, ctx());
  set({ data: draft });
  scheduleSave();
  return result;
}

let toastId = 0;
export function toast(message: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }));
  setTimeout(() => dismissToast(id), tone === 'error' ? 8000 : 5000);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ---------------------------------------------------------------- init / reset

function migrate(raw: AppData | null): AppData | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== SCHEMA_VERSION) return null;
  // Forward-compatible defaults for optional preview fields.
  raw.preview = { ...raw.preview, failGenerationNext: false, missedPromptDismissed: raw.preview.missedPromptDismissed ?? false };
  // The simplified demo has a single approving user and no failure simulator; older settings stay stored but unused.
  raw.preview.role = 'admin';
  raw.preview.failure = { kind: 'none', destinationId: 'any' };
  return raw;
}

let initPromise: Promise<void> | null = null;

/** Load (or seed) the workspace once per page, even if called repeatedly (e.g. React StrictMode). */
export function initStore(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  let data: AppData | null = null;
  let storageError: string | null = null;
  try {
    data = migrate(await db.loadState<AppData>());
  } catch {
    storageError = 'Local storage is unavailable in this browser. This session will work, but changes will not be kept after closing the tab.';
  }
  if (!data) {
    data = buildSimpleSeed(new Date(), browserZone());
    set({ data, ready: true, storageError });
    savePending = true;
    await flushSave();
    if (storageError) set({ storageError });
    return;
  }
  set({ data, ready: true, storageError });
}

export async function resetWorkspace() {
  try {
    await db.clearAppData();
  } catch {
    /* fall through: we still reseed in memory */
  }
  db.clearPrefs();
  const data = buildSimpleSeed(new Date(), browserZone());
  set({ data, missedLater: [], toasts: [], inflight: {} });
  savePending = true;
  await flushSave();
  channel?.postMessage({ type: 'reset', from: TAB_ID });
}

// ---------------------------------------------------------------- publishing (async simulated send)

const SEND_DELAY_MS = 700;

export async function publishDelivery(deliveryId: string, manual: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (get().inflight[deliveryId]) return { ok: false, reason: 'Already sending.' };
  const res = act((d, c) => beginPublish(d, c, deliveryId, { manual }));
  if (!res.started) return { ok: false, reason: res.reason };
  set((s) => ({ inflight: { ...s.inflight, [deliveryId]: true } }));
  try {
    const del = get().data.deliveries[deliveryId];
    let claimed = true;
    try {
      claimed = await db.claim(`send:${del.deliveryKey}#${del.attempts}`);
    } catch {
      claimed = true; // storage unavailable: in-tab guard still applies
    }
    if (!claimed) {
      // Another tab is sending this exact attempt; wait for its result instead of sending twice.
      act((d) => {
        const x = d.deliveries[deliveryId];
        if (x && x.status === 'publishing') {
          x.status = 'processing';
          x.error = { kind: 'ambiguous', message: 'Needs status check — another tab handled this send.' };
        }
      });
      return { ok: false, reason: 'Handled in another tab.' };
    }
    await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    act((d, c) => completePublish(d, c, deliveryId));
    const after = get().data.deliveries[deliveryId];
    return { ok: after.status === 'published_preview', reason: after.error?.message };
  } finally {
    set((s) => {
      const next = { ...s.inflight };
      delete next[deliveryId];
      return { inflight: next };
    });
  }
}

export function checkDeliveryStatus(deliveryId: string) {
  return act((d, c) => checkStatus(d, c, deliveryId));
}

export function bumpTick() {
  set((s) => ({ tick: s.tick + 1 }));
}

export { SEED_VERSION };
