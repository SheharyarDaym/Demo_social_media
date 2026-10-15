import { act, toast } from './store';
import * as db from '../persistence/db';
import { validateUpload, aspectLabel, UploadError } from '../services/media';
import { log } from '../domain/ops';
import { uid } from '../domain/util';

/**
 * Validate and store an uploaded image (Blob in IndexedDB, metadata in state).
 * Returns the new media id, or null with a friendly toast on failure (existing selection is untouched).
 */
export async function uploadImage(file: File, campaignHint = ''): Promise<string | null> {
  try {
    const v = await validateUpload(file);
    const id = uid('upl');
    const blobKey = `media:${id}`;
    await db.putBlob(blobKey, v.blob);
    act((d, c) => {
      d.media[id] = {
        id,
        kind: 'image',
        source: 'upload',
        title: v.name.replace(/\.[a-z0-9]+$/i, ''),
        alt: '',
        topic: 'custom',
        variants: null,
        src: null,
        blobKey,
        poster: null,
        mime: v.mime,
        width: v.width,
        height: v.height,
        durationSec: null,
        sizeBytes: file.size,
        hidden: false,
        createdAt: c.now.toISOString(),
        campaignHint,
      };
      log(d, c, 'media.uploaded', id, `Uploaded “${v.name}” (${v.width}×${v.height}, ${aspectLabel(v.width, v.height)})`);
    });
    return id;
  } catch (e) {
    if (e instanceof UploadError) toast(e.message, 'error');
    else if (e instanceof DOMException && e.name === 'QuotaExceededError') toast('The image could not be saved: browser storage is full.', 'error');
    else toast('The image could not be saved locally. Your current image was kept.', 'error');
    return null;
  }
}

