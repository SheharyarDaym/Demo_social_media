// Demo rules: one configurable place for the prototype's platform/format matrix and length budgets.
// These are intentionally limited preview experiences, not a statement of current platform API capabilities.
// Re-check every live-platform specification before building production integrations.

import type { Format, Platform } from './types';

export const PLATFORMS: Platform[] = ['facebook', 'instagram', 'linkedin', 'x', 'snapchat', 'tiktok', 'youtube'];

export const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  snapchat: 'Snapchat',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export const PLATFORM_COLOR: Record<Platform, string> = {
  facebook: '#1877F2',
  instagram: '#C13584',
  linkedin: '#0A66C2',
  x: '#111111',
  snapchat: '#C9B800',
  tiktok: '#111111',
  youtube: '#E00000',
};

export const FORMATS: Format[] = ['image', 'carousel', 'story', 'short_video', 'video'];

export const FORMAT_LABEL: Record<Format, string> = {
  image: 'Image',
  carousel: 'Carousel',
  story: 'Story image',
  short_video: 'Short video',
  video: 'Video',
};

/** Demo compatibility matrix (see 03_WORKFLOWS_AND_RULES.md §B). */
export const COMPATIBILITY: Record<Platform, Format[]> = {
  facebook: ['image', 'carousel', 'short_video', 'video'],
  instagram: ['image', 'carousel', 'story', 'short_video'],
  linkedin: ['image', 'carousel', 'short_video', 'video'],
  x: ['image', 'short_video'],
  // Snapchat shows the vertical (Story) composition of the same image.
  snapchat: ['image', 'story', 'short_video'],
  tiktok: ['image', 'carousel', 'short_video'],
  youtube: ['short_video', 'video'],
};

/** How each platform presents a format in this prototype. */
export function experienceLabel(platform: Platform, format: Format): string {
  const map: Partial<Record<Platform, Partial<Record<Format, string>>>> = {
    facebook: { image: 'Feed post', carousel: 'Image collection', short_video: 'Feed video', video: 'Feed video' },
    instagram: { image: 'Feed post', carousel: 'Carousel', story: 'Story', short_video: 'Reel' },
    linkedin: { image: 'Feed post', carousel: 'Multi-image post', short_video: 'Video post', video: 'Video post' },
    x: { image: 'Post with image', short_video: 'Post with short video' },
    snapchat: { image: 'Public Story', story: 'Public Story', short_video: 'Spotlight' },
    tiktok: { image: 'Photo post', carousel: 'Photo post', short_video: 'Video' },
    youtube: { short_video: 'Short', video: 'Video' },
  };
  return map[platform]?.[format] ?? FORMAT_LABEL[format];
}

export function isCompatible(platform: Platform, format: Format): boolean {
  return COMPATIBILITY[platform].includes(format);
}

/** Suggest the best default format that every platform in the set supports, or null. */
export function commonFormat(platforms: Platform[]): Format | null {
  if (platforms.length === 0) return 'image';
  const order: Format[] = ['image', 'carousel', 'short_video', 'story', 'video'];
  return order.find((f) => platforms.every((p) => isCompatible(p, f))) ?? null;
}

export function defaultFormatFor(platform: Platform): Format {
  if (platform === 'youtube') return 'short_video';
  if (platform === 'snapchat') return 'story';
  return 'image';
}

export const DEMO_LIMITS = {
  /** Conservative demo caption budget for X; counts every character of the rendered caption + hashtags. */
  xCaptionBudget: 280,
  /** Generic soft caption budgets for the counter display (demo values, not platform limits). */
  captionSoftLimit: { facebook: 2000, instagram: 2200, linkedin: 3000, x: 280, snapchat: 250, tiktok: 2200, youtube: 5000 } as Record<Platform, number>,
  youtubeTitleMax: 100,
  uploadMaxBytes: 10 * 1024 * 1024,
  uploadMimes: ['image/png', 'image/jpeg', 'image/webp'],
  carouselImages: 3,
  maxPublishAttempts: 3,
  /** Retry delays (minutes of demo clock) for transient failures: 5, 15, 45. */
  retryDelaysMin: [5, 15, 45],
};

/** Group colour accents for named content versions. */
export const GROUP_COLORS = ['#0A477F', '#E50914', '#177453', '#7A4FD0', '#976014', '#0E7C99', '#B42338'];

export function formatNeedsVideo(format: Format): boolean {
  return format === 'short_video' || format === 'video';
}
