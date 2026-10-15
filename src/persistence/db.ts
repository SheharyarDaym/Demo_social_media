// Minimal typed IndexedDB wrapper scoped to this app's own database.
// Domain state is one JSON document; uploaded media are stored as Blobs (never base64 in localStorage).
// `claims` provides transaction-level uniqueness for scheduler occurrences and sends across tabs.

export const DB_NAME = 'lgp-social-studio';
export const DB_VERSION = 1;
const STATE_KEY = 'state:v1';

type StoreName = 'kv' | 'blobs' | 'claims';

let dbPromise: Promise<IDBDatabase> | null = null;

export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!storageAvailable()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('claims')) db.createObjectStore('claims', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
    req.onblocked = () => reject(new Error('Local storage is blocked by another tab'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result: T | undefined;
        const req = fn(s);
        let reqError: DOMException | null = null;
        if (req) {
          req.onsuccess = () => (result = req.result);
          req.onerror = () => (reqError = req.error);
        }
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(reqError ?? t.error ?? new Error('Storage transaction failed'));
        t.onabort = () => reject(reqError ?? t.error ?? new Error('Storage transaction aborted'));
      }),
  );
}

export async function loadState<T>(): Promise<T | null> {
  const v = await tx<T>('kv', 'readonly', (s) => s.get(STATE_KEY) as IDBRequest<T>);
  return v ?? null;
}

export async function saveState<T>(data: T): Promise<void> {
  await tx('kv', 'readwrite', (s) => s.put(data, STATE_KEY));
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await tx('blobs', 'readwrite', (s) => s.put(blob, key));
}

export async function getBlob(key: string): Promise<Blob | null> {
  const v = await tx<Blob>('blobs', 'readonly', (s) => s.get(key) as IDBRequest<Blob>);
  return v ?? null;
}

export async function deleteBlob(key: string): Promise<void> {
  await tx('blobs', 'readwrite', (s) => s.delete(key));
}

/**
 * Atomically claim a unique key (e.g. a scheduler occurrence or a send attempt).
 * Resolves true only for the first claimant across all tabs.
 */
export async function claim(key: string): Promise<boolean> {
  try {
    await tx('claims', 'readwrite', (s) => s.add({ key, at: new Date().toISOString() }));
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'ConstraintError') return false;
    throw e;
  }
}

/** Clear ONLY this application's stores. Never touches other databases or localStorage keys. */
export async function clearAppData(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(['kv', 'blobs', 'claims'], 'readwrite');
    t.objectStore('kv').clear();
    t.objectStore('blobs').clear();
    t.objectStore('claims').clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Test helper: drop the cached connection. */
export function _resetConnectionForTests() {
  dbPromise = null;
}

export const PREFS_PREFIX = 'lgp-social-studio:v1:';

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFS_PREFIX + key);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(PREFS_PREFIX + key, value);
  } catch {
    /* preferences are optional */
  }
}

/** Remove only this app's preference keys. */
export function clearPrefs() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
