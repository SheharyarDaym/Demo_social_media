// Media helpers: resolve display URLs, manage blob object URLs, and validate uploads.
// Object URLs are temporary view handles. They are recreated from IndexedDB on mount and revoked when unused.

import { useEffect, useState } from 'react';
import { DEMO_LIMITS } from '../domain/rules';
import type { MediaAsset } from '../domain/types';
import * as db from '../persistence/db';

export type Composition = 'portrait' | 'square' | 'story';

const cache = new Map<string, { url: string; refs: number; revokeTimer?: ReturnType<typeof setTimeout> }>();
const pending = new Map<string, Promise<string | null>>();

async function acquireBlobUrl(blobKey: string): Promise<string | null> {
  const hit = cache.get(blobKey);
  if (hit) {
    hit.refs++;
    if (hit.revokeTimer) clearTimeout(hit.revokeTimer);
    return hit.url;
  }
  let p = pending.get(blobKey);
  if (!p) {
    p = db
      .getBlob(blobKey)
      .then((blob) => {
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        cache.set(blobKey, { url, refs: 0 });
        return url;
      })
      .catch(() => null)
      .finally(() => pending.delete(blobKey));
    pending.set(blobKey, p);
  }
  const url = await p;
  const entry = cache.get(blobKey);
  if (entry) entry.refs++;
  return url;
}

function releaseBlobUrl(blobKey: string) {
  const entry = cache.get(blobKey);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    // Short grace period avoids flicker when the same image re-mounts immediately.
    entry.revokeTimer = setTimeout(() => {
      const e = cache.get(blobKey);
      if (e && e.refs <= 0) {
        URL.revokeObjectURL(e.url);
        cache.delete(blobKey);
      }
    }, 3000);
  }
}

export function staticUrl(asset: MediaAsset, comp: Composition = 'portrait'): string | null {
  if (asset.kind === 'video') return asset.src;
  if (asset.variants) return asset.variants[comp];
  return null;
}

/** Resolve a displayable URL for a media asset; uploaded blobs are loaded from IndexedDB. */
export function useMediaUrl(asset: MediaAsset | undefined | null, comp: Composition = 'portrait'): { url: string | null; missing: boolean } {
  const blobKey = asset?.source === 'upload' ? asset.blobKey : null;
  const direct = asset && !blobKey ? staticUrl(asset, comp) : null;
  const [state, setState] = useState<{ key: string | null; url: string | null; missing: boolean }>({ key: null, url: null, missing: false });
  useEffect(() => {
    if (!blobKey) return;
    let alive = true;
    void acquireBlobUrl(blobKey).then((url) => {
      if (alive) setState({ key: blobKey, url, missing: !url });
      else if (url) releaseBlobUrl(blobKey);
    });
    return () => {
      alive = false;
      releaseBlobUrl(blobKey);
    };
  }, [blobKey]);
  if (!asset) return { url: null, missing: true };
  if (!blobKey) return { url: direct, missing: !direct };
  return state.key === blobKey ? { url: state.url, missing: state.missing } : { url: null, missing: false };
}

export interface ValidatedUpload {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  name: string;
}

export class UploadError extends Error {}

function decode(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) reject(new UploadError('This image has no readable dimensions.'));
      else resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UploadError('This file could not be read as an image. It may be damaged or not really a PNG, JPEG or WebP file.'));
    };
    img.src = url;
  });
}

/** Validate MIME, size and decode success. Throws UploadError with a corrective message. */
export async function validateUpload(file: File): Promise<ValidatedUpload> {
  if (!DEMO_LIMITS.uploadMimes.includes(file.type)) {
    throw new UploadError(`“${file.name}” is not a supported image. Use PNG, JPEG or WebP.`);
  }
  if (file.size > DEMO_LIMITS.uploadMaxBytes) {
    throw new UploadError(`“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB per image.`);
  }
  if (file.size === 0) throw new UploadError(`“${file.name}” is empty.`);
  const { width, height } = await decode(file);
  return { blob: file, width, height, mime: file.type, name: file.name };
}

export function aspectLabel(w: number, h: number): 'portrait' | 'landscape' | 'square' {
  const r = w / h;
  if (r > 1.1) return 'landscape';
  if (r < 0.9) return 'portrait';
  return 'square';
}

/**
 * Render an image to a canvas at a target aspect, matching the chosen fit/fill + focal point framing.
 * Used to export exactly what the preview shows.
 */
