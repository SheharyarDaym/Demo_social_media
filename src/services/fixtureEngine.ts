// Pure fixture-based content engine. No network, no AI: deterministic selection from prepared variations.
// "This preview uses prepared content variations. Live AI will use your approved business details."

import { CUSTOM_HASHTAGS, CUSTOM_TEMPLATES, SHARED_IG_LINKEDIN, TONE_STYLE, TOPICS } from '../fixtures/captions';
import { DEMO_LIMITS, formatNeedsVideo } from '../domain/rules';
import type {
  Brief,
  CaptionLength,
  DestinationMeta,
  Format,
  GenerationCursor,
  Platform,
  Tone,
  Topic,
  TopicKey,
} from '../domain/types';
import { dedupeHashtags, xLength } from '../domain/util';

export const VARIANT_COUNT = 3;

export type Voice = 'general' | 'linkedin' | 'x' | 'shared_ig_li';

export const FAMILY_ASSETS: Record<TopicKey, string[]> = {
  training: ['pool-01', 'pool-02', 'pool-03'],
  preparedness: ['gear-01', 'gear-02', 'gear-03'],
  team: ['team-01', 'team-02', 'team-03'],
  questions: ['questions-01', 'questions-02', 'questions-03'],
};

export const VIDEO_PORTRAIT_ID = 'video-portrait';
export const VIDEO_LANDSCAPE_ID = 'video-landscape';

export function voiceFor(platforms: Platform[]): Voice {
  const set = new Set(platforms);
  if (set.size === 1 && set.has('linkedin')) return 'linkedin';
  if (set.has('x')) return 'x';
  if (set.size === 2 && set.has('instagram') && set.has('linkedin')) return 'shared_ig_li';
  return 'general';
}

function sanitizeTopic(raw: string): string {
  const t = raw.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, 80);
  return t || 'your next learning goal';
}

function topicKeyOf(brief: Pick<Brief, 'topic' | 'visualFamily'>): TopicKey {
  return brief.topic === 'custom' ? brief.visualFamily : brief.topic;
}

function baseCaption(topic: Topic, customTopic: string, voice: Voice, index: number, length: CaptionLength): string {
  const i = ((index % VARIANT_COUNT) + VARIANT_COUNT) % VARIANT_COUNT;
  if (topic === 'custom') {
    const t = sanitizeTopic(customTopic);
    const cap = t.charAt(0).toUpperCase() + t.slice(1);
    return CUSTOM_TEMPLATES[i].replaceAll('{topic}', t).replaceAll('{Topic}', cap);
  }
  const bank = TOPICS[topic];
  if (voice === 'linkedin') return bank.linkedin[i];
  if (voice === 'x') return bank.x[i];
  if (voice === 'shared_ig_li') return SHARED_IG_LINKEDIN[i];
  // Short general copy reuses the concise variant for the same index.
  return length === 'short' ? bank.x[i] : bank.general[i];
}

function extendedSentence(topic: Topic, index: number): string {
  const key: TopicKey = topic === 'custom' ? 'questions' : topic;
  return TOPICS[key].extended[index % VARIANT_COUNT];
}

export interface CaptionInput {
  topic: Topic;
  customTopic: string;
  tone: Tone;
  length: CaptionLength;
  voice: Voice;
  index: number;
}

/** Compose a caption with visible tone and length effects. */
export function composeCaption(input: CaptionInput): string {
  const { topic, customTopic, tone, length, voice, index } = input;
  const parts: string[] = [];
  const style = TONE_STYLE[tone];
  const i = index % VARIANT_COUNT;
  if (style.openers.length) parts.push(style.openers[i]);
  let body = baseCaption(topic, customTopic, voice, index, length);
  if (tone === 'energetic') body = body.replace(/\.$/, '!');
  parts.push(body);
  if (length === 'long') parts.push(extendedSentence(topic, index));
  if (style.closers.length && length !== 'short') parts.push(style.closers[i]);
  return parts.join(' ');
}

export function hashtagSet(topic: Topic, index: number): string[] {
  const sets = topic === 'custom' ? CUSTOM_HASHTAGS : TOPICS[topic].hashtagSets;
  return dedupeHashtags(sets[((index % sets.length) + sets.length) % sets.length]);
}

export function imageForIndex(family: TopicKey, index: number): string {
  const list = FAMILY_ASSETS[family];
  return list[((index % list.length) + list.length) % list.length];
}

export function mediaForFormat(format: Format, family: TopicKey, imageIndex: number): { mediaIds: string[]; thumbnailMediaId: string | null } {
  if (format === 'short_video') return { mediaIds: [VIDEO_PORTRAIT_ID], thumbnailMediaId: imageForIndex(family, imageIndex) };
  if (format === 'video') return { mediaIds: [VIDEO_LANDSCAPE_ID], thumbnailMediaId: imageForIndex(family, imageIndex) };
  if (format === 'carousel') {
    return {
      mediaIds: Array.from({ length: DEMO_LIMITS.carouselImages }, (_, k) => imageForIndex(family, imageIndex + k)),
      thumbnailMediaId: null,
    };
  }
  return { mediaIds: [imageForIndex(family, imageIndex)], thumbnailMediaId: null };
}

export function defaultMeta(topic: Topic, format: Format, imageIndex: number, customTopic: string): DestinationMeta {
  const key: TopicKey = topic === 'custom' ? 'questions' : topic;
  const bank = TOPICS[key];
  const customTitle = topic === 'custom' ? `Let’s talk about ${sanitizeTopic(customTopic)}` : null;
  return {
    youtubeTitle: customTitle ?? (format === 'video' ? bank.youtubeVideoTitle : bank.youtubeShortTitle),
    youtubePrivacy: 'public',
    youtubeAudience: 'not_for_kids',
    syntheticDisclosure: 'none',
    tiktokCommercial: 'own_brand',
    tiktokAiLabel: false,
    storyHeadline: customTitle ?? bank.storyHeadlines[imageIndex % VARIANT_COUNT],
  };
}

export interface GroupSpec {
  destinationIds: string[];
  platforms: Platform[];
  format: Format;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  ctaText: string;
  mediaIds: string[];
  thumbnailMediaId: string | null;
  meta: DestinationMeta;
  cursor: GenerationCursor;
}

/** Cursor-key helpers. Cursors advance so consecutive generations and separate groups differ. */
export const cursorKeys = {
  caption: (topic: Topic, voice: Voice) => `${topic}:${voice}`,
  image: (family: TopicKey) => family,
  hashtag: (topic: Topic) => topic,
};

export interface CursorState {
  caption: Record<string, number>;
  hashtag: Record<string, number>;
  image: Record<string, number>;
}

/**
 * Generate content for each group. Returns new cursor state; does not mutate inputs.
 * Groups that include X are composed to stay within the demo X budget without truncation.
 */
export function generateGroups(
  brief: Pick<Brief, 'topic' | 'customTopic' | 'visualFamily' | 'tone' | 'length' | 'cta'>,
  groups: GroupSpec[],
  cursors: CursorState,
): { contents: GeneratedContent[]; cursors: CursorState } {
  const next: CursorState = { caption: { ...cursors.caption }, hashtag: { ...cursors.hashtag }, image: { ...cursors.image } };
  const family = topicKeyOf(brief);
  const contents = groups.map((g) => {
    const voice = voiceFor(g.platforms);
    const cKey = cursorKeys.caption(brief.topic, voice);
    const captionIndex = next.caption[cKey] ?? 0;
    next.caption[cKey] = captionIndex + 1;
    const hKey = cursorKeys.hashtag(brief.topic);
    const hashtagIndex = next.hashtag[hKey] ?? 0;
    next.hashtag[hKey] = hashtagIndex + 1;
    const iKey = cursorKeys.image(family);
    const imageIndex = next.image[iKey] ?? 0;
    next.image[iKey] = imageIndex + (g.format === 'carousel' ? DEMO_LIMITS.carouselImages : 1);
    const hashtags = hashtagSet(brief.topic, hashtagIndex);
    const caption = fitCaption(brief, voice, captionIndex, hashtags, g.platforms);
    const media = mediaForFormat(g.format, family, imageIndex);
    return {
      caption,
      hashtags,
      ctaText: brief.cta,
      ...media,
      meta: defaultMeta(brief.topic, g.format, imageIndex, brief.customTopic),
      cursor: { topic: brief.topic, captionIndex, hashtagIndex, imageIndex },
    };
  });
  return { contents, cursors: next };
}

/** For groups containing X, step down length/tone extras until the demo budget fits. Never truncates text. */
function fitCaption(
  brief: Pick<Brief, 'topic' | 'customTopic' | 'tone' | 'length'>,
  voice: Voice,
  index: number,
  hashtags: string[],
  platforms: Platform[],
): string {
  const make = (length: CaptionLength, tone: Tone) =>
    composeCaption({ topic: brief.topic, customTopic: brief.customTopic, tone, length, voice, index });
  if (!platforms.includes('x')) return make(brief.length, brief.tone);
  const attempts: [CaptionLength, Tone][] = [
    [brief.length, brief.tone],
    ['medium', brief.tone],
    ['short', brief.tone],
    ['short', 'professional'],
  ];
  for (const [l, t] of attempts) {
    const c = make(l, t);
    if (xLength(c, hashtags, '') <= DEMO_LIMITS.xCaptionBudget - 30) return c;
  }
  return make('short', 'professional');
}

export function nextCaption(
  brief: Pick<Brief, 'topic' | 'customTopic' | 'tone' | 'length'>,
  platforms: Platform[],
  cursor: GenerationCursor,
  hashtags: string[],
): { caption: string; cursor: GenerationCursor } {
  const captionIndex = (cursor.captionIndex + 1) % VARIANT_COUNT;
  const voice = voiceFor(platforms);
  return { caption: fitCaption(brief, voice, captionIndex, hashtags, platforms), cursor: { ...cursor, captionIndex } };
}

export function nextHashtags(topic: Topic, cursor: GenerationCursor): { hashtags: string[]; cursor: GenerationCursor } {
  const hashtagIndex = (cursor.hashtagIndex + 1) % VARIANT_COUNT;
  return { hashtags: hashtagSet(topic, hashtagIndex), cursor: { ...cursor, hashtagIndex } };
}

export function nextImage(
  family: TopicKey,
  format: Format,
  cursor: GenerationCursor,
): { mediaIds: string[]; thumbnailMediaId: string | null; cursor: GenerationCursor } {
  const imageIndex = (cursor.imageIndex + 1) % VARIANT_COUNT;
  if (formatNeedsVideo(format)) {
    // Videos keep the sample clip; regenerating changes the thumbnail.
    return { ...mediaForFormat(format, family, imageIndex), cursor: { ...cursor, imageIndex } };
  }
  return { ...mediaForFormat(format, family, imageIndex), cursor: { ...cursor, imageIndex } };
}

export { topicKeyOf };
