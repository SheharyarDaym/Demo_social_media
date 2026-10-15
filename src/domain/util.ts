import type { ContentGroup, ContentRevision } from './types';

let counter = 0;
let deterministic: { n: number } | null = null;

/** Run `fn` with deterministic, sequential IDs (used for seeding and tests). */
export function withDeterministicIds<T>(fn: () => T): T {
  const prev = deterministic;
  deterministic = { n: 0 };
  try {
    return fn();
  } finally {
    deterministic = prev;
  }
}

/** Unique-enough local ID. Seed data uses deterministic IDs instead. */
export function uid(prefix: string): string {
  if (deterministic) {
    deterministic.n += 1;
    return `${prefix}_seed${deterministic.n.toString().padStart(4, '0')}`;
  }
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** Deterministic JSON stringify with sorted keys so hashes are stable. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** FNV-1a 32-bit, hex. Sufficient for local change detection (not a security hash). */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type RevisionContent = Pick<
  ContentRevision,
  'caption' | 'hashtags' | 'ctaText' | 'ctaLink' | 'mediaIds' | 'thumbnailMediaId' | 'crop' | 'altText' | 'meta'
>;

/** Hash of everything that is part of approval scope for a revision's content. */
export function contentHashOf(content: RevisionContent): string {
  return fnv1a(
    stableStringify({
      caption: content.caption,
      hashtags: content.hashtags,
      ctaText: content.ctaText,
      ctaLink: content.ctaLink,
      mediaIds: content.mediaIds,
      thumbnailMediaId: content.thumbnailMediaId,
      crop: content.crop,
      altText: content.altText,
      meta: content.meta,
    }),
  );
}

export function pickContent(r: ContentRevision): RevisionContent {
  return {
    caption: r.caption,
    hashtags: [...r.hashtags],
    ctaText: r.ctaText,
    ctaLink: r.ctaLink,
    mediaIds: [...r.mediaIds],
    thumbnailMediaId: r.thumbnailMediaId,
    crop: { ...r.crop },
    altText: { ...r.altText },
    meta: { ...r.meta },
  };
}

export function normalizeHashtag(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
  return cleaned ? `#${cleaned}` : null;
}

/** Remove duplicate hashtags (case-insensitive), keeping first occurrence. */
export function dedupeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeHashtag(t);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Final rendered caption: body + hashtags appended exactly once.
 * Hashtags already present in the body are not appended a second time.
 */
export function renderCaption(caption: string, hashtags: string[]): string {
  const body = caption.trim();
  const inBody = new Set((body.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.toLowerCase()));
  const extra = dedupeHashtags(hashtags).filter((t) => !inBody.has(t.toLowerCase()));
  return extra.length ? `${body}\n\n${extra.join(' ')}` : body;
}

/**
 * Demo approximation of X length: counts Unicode code points of the rendered caption,
 * plus CTA link counted at its full length. Not an implementation of X's weighted rules.
 */
export function xLength(caption: string, hashtags: string[], ctaLink: string): number {
  const text = renderCaption(caption, hashtags) + (ctaLink ? `\n${ctaLink}` : '');
  return [...text].length;
}

export function groupLabel(g: ContentGroup): string {
  return g.name;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
