// ContentGenerator service contract + the local fixture implementation used by this preview.
// A production adapter (real AI provider behind a server) can implement the same interface later.
// No API keys are stored in the browser and no network requests are made here.

import type { Brief, Format, GenerationCursor, Platform, TopicKey } from '../domain/types';
import {
  generateGroups,
  nextCaption,
  nextHashtags,
  nextImage,
  type CursorState,
  type GeneratedContent,
  type GroupSpec,
} from './fixtureEngine';

export interface GenerateRequest {
  brief: Brief;
  groups: GroupSpec[];
  cursors: CursorState;
}
export interface GeneratedGroups {
  contents: GeneratedContent[];
  cursors: CursorState;
}
export interface CaptionRequest {
  brief: Brief;
  platforms: Platform[];
  cursor: GenerationCursor;
  hashtags: string[];
}
export interface CaptionResult {
  caption: string;
  cursor: GenerationCursor;
}
export interface ImageRequest {
  family: TopicKey;
  format: Format;
  cursor: GenerationCursor;
}
export interface MediaChoice {
  mediaIds: string[];
  thumbnailMediaId: string | null;
  cursor: GenerationCursor;
}

export interface ContentGenerator {
  generate(request: GenerateRequest, signal?: AbortSignal, onStep?: (step: number) => void): Promise<GeneratedGroups>;
  regenerateCaption(request: CaptionRequest, signal?: AbortSignal): Promise<CaptionResult>;
  regenerateImage(request: ImageRequest, signal?: AbortSignal): Promise<MediaChoice>;
}

export const GENERATION_STEPS = ['Preparing ideas', 'Writing captions', 'Selecting visual', 'Preparing previews'];

export class GenerationCancelled extends Error {
  constructor() {
    super('Generation cancelled');
  }
}
export class GenerationFailed extends Error {}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GenerationCancelled());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new GenerationCancelled());
      },
      { once: true },
    );
  });
}

/** Show the generation steps over ~totalMs (cancellable). Content itself comes from prepared local variations. */
export async function stagedProgress(totalMs: number, signal: AbortSignal, onStep: (step: number) => void): Promise<void> {
  const per = totalMs / GENERATION_STEPS.length;
  for (let i = 0; i < GENERATION_STEPS.length; i++) {
    onStep(i);
    await wait(per, signal);
  }
}

export interface FixtureGeneratorOptions {
  /** Total simulated time for a complete generation (spec: roughly 2–3 seconds). */
  totalMs?: number;
  /** Returns true once to simulate a failure (Preview Controls). */
  consumeFailure?: () => boolean;
}

export function createFixtureGenerator(opts: FixtureGeneratorOptions = {}): ContentGenerator {
  const total = opts.totalMs ?? 2400;
  return {
    async generate(request, signal, onStep) {
      const per = total / GENERATION_STEPS.length;
      for (let i = 0; i < GENERATION_STEPS.length; i++) {
        onStep?.(i);
        await wait(per, signal);
        if (i === 1 && opts.consumeFailure?.()) throw new GenerationFailed('Generation could not finish (simulated failure). Nothing was saved. Try again.');
      }
      return generateGroups(request.brief, request.groups, request.cursors);
    },
    async regenerateCaption(request, signal) {
      await wait(Math.min(700, total / 3), signal);
      return nextCaption(request.brief, request.platforms, request.cursor, request.hashtags);
    },
    async regenerateImage(request, signal) {
      await wait(Math.min(700, total / 3), signal);
      return nextImage(request.family, request.format, request.cursor);
    },
  };
}

export { nextHashtags };
