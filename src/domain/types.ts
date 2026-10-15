// Core domain model for the Social Studio prototype.
// All timestamps are ISO-8601 UTC strings; display timezone is stored separately.

export type Platform = 'facebook' | 'instagram' | 'linkedin' | 'x' | 'snapchat' | 'tiktok' | 'youtube';
export type Format = 'image' | 'carousel' | 'story' | 'short_video' | 'video';
export type TopicKey = 'training' | 'preparedness' | 'team' | 'questions';
export type Topic = TopicKey | 'custom';
export type Tone = 'professional' | 'friendly' | 'energetic';
export type CaptionLength = 'short' | 'medium' | 'long';
export type Objective = 'awareness' | 'educational' | 'course_interest' | 'engagement' | 'announcement';
export type GroupingMode = 'same' | 'separate' | 'custom';
export type Role = 'admin' | 'editor';

export type ReviewState = 'draft' | 'in_review' | 'changes_requested' | 'rejected' | 'approved';
export type DeliveryStatus =
  | 'not_scheduled'
  | 'scheduled'
  | 'blocked'
  | 'publishing'
  | 'processing'
  | 'published_preview'
  | 'failed'
  | 'cancelled';

export type ConnectionState = 'preview_connected' | 'disconnected' | 'reconnect_required';

export interface Destination {
  id: string;
  platform: Platform;
  displayName: string;
  formatCapabilities: Format[];
  connection: ConnectionState;
}

export interface BrandProfile {
  name: string;
  website: string;
  audience: string;
  voice: string;
  primaryColor: string;
  accentColor: string;
  logoMediaId: string | null;
  approvedFacts: string[];
  prohibitedClaims: string[];
  approvedCtas: string[];
  timezone: string;
}

export interface Brief {
  topic: Topic;
  customTopic: string;
  visualFamily: TopicKey;
  instructions: string;
  objective: Objective;
  audience: string;
  tone: Tone;
  length: CaptionLength;
  cta: string;
}

export interface Campaign {
  id: string;
  title: string;
  brief: Brief;
  mode: GroupingMode;
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  archived: boolean;
  origin: { kind: 'manual' } | { kind: 'schedule'; scheduleId: string; runId: string };
  /** Snapshot of brand name/website used at generation; brand edits never mutate existing drafts. */
  brandSnapshot: { name: string; website: string };
}

export interface CropSettings {
  fit: 'fill' | 'fit';
  /** Focal point 0..100 (percent) used for object-position. */
  focalX: number;
  focalY: number;
}

export interface DestinationMeta {
  youtubeTitle: string;
  youtubePrivacy: 'public' | 'unlisted' | 'private';
  youtubeAudience: 'not_for_kids' | 'for_kids';
  syntheticDisclosure: 'none' | 'altered_or_synthetic';
  tiktokCommercial: 'none' | 'own_brand' | 'branded_content';
  tiktokAiLabel: boolean;
  storyHeadline: string;
}

export interface GenerationCursor {
  topic: Topic;
  captionIndex: number;
  hashtagIndex: number;
  imageIndex: number;
}

export interface ContentRevision {
  id: string;
  groupId: string;
  revisionNumber: number;
  caption: string;
  hashtags: string[];
  ctaText: string;
  ctaLink: string;
  mediaIds: string[];
  thumbnailMediaId: string | null;
  crop: CropSettings;
  altText: Record<string, string>;
  meta: DestinationMeta;
  contentHash: string;
  createdAt: string;
  author: string;
  note: string;
  cursor: GenerationCursor;
}

export interface ReviewEvent {
  id: string;
  at: string;
  actor: string;
  action:
    | 'submitted'
    | 'approved'
    | 'changes_requested'
    | 'rejected'
    | 'invalidated'
    | 'comment'
    | 'reopened'
    | 'created';
  note: string;
  revisionNumber: number;
}

export interface ContentGroup {
  id: string;
  campaignId: string;
  name: string;
  color: string;
  destinationIds: string[];
  format: Format;
  currentRevisionId: string;
  revisionIds: string[];
  reviewState: ReviewState;
  /** Latest note from a reviewer (changes requested / rejected). */
  reviewNote: string;
  currentApprovalId: string | null;
  /** Proposed publication time per destination (UTC ISO). Part of approval scope once approved. */
  proposedTimes: Record<string, string | null>;
  /** True when content changed after a previous approval and needs fresh review. */
  changedAfterApproval: boolean;
  history: ReviewEvent[];
}

export interface PublicationIntent {
  id: string;
  destinationId: string;
  revisionId: string;
  mode: 'now' | 'scheduled';
  scheduledAtUTC: string;
  displayTimezone: string;
}

export interface Approval {
  id: string;
  groupId: string;
  revisionId: string;
  revisionNumber: number;
  contentHash: string;
  destinationIds: string[];
  intents: PublicationIntent[];
  approvedBy: string;
  approvedAt: string;
  invalidatedAt: string | null;
  invalidReason: string;
}

export type DeliveryErrorKind = 'clear' | 'transient' | 'reconnect' | 'ambiguous' | 'guard';

export interface Delivery {
  id: string;
  campaignId: string;
  groupId: string;
  destinationId: string;
  revisionId: string;
  approvalId: string;
  intentId: string;
  deliveryKey: string;
  status: DeliveryStatus;
  scheduledAtUTC: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  receipt: { id: string; at: string } | null;
  error: { kind: DeliveryErrorKind; message: string } | null;
  /** Reason shown when status is `blocked`. */
  blockedReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  kind: 'image' | 'video';
  source: 'bundled' | 'upload';
  title: string;
  alt: string;
  topic: TopicKey | 'any' | 'custom';
  /** Bundled assets: static URL per composition. Uploads: blob key in IndexedDB. */
  variants: { portrait: string; square: string; story: string } | null;
  src: string | null;
  blobKey: string | null;
  poster: string | null;
  mime: string;
  width: number;
  height: number;
  durationSec: number | null;
  sizeBytes: number | null;
  hidden: boolean;
  createdAt: string;
  campaignHint: string;
}

export type Recurrence =
  | { kind: 'once' }
  | { kind: 'hours'; everyHours: number }
  | { kind: 'daily' }
  | { kind: 'weekdays'; weekdays: number[] } // ISO weekday 1=Mon..7=Sun
  | { kind: 'weekly' };

export interface ScheduleGroupTemplate {
  name: string;
  destinationIds: string[];
  format: Format;
}

export interface GenerationSchedule {
  id: string;
  name: string;
  enabled: boolean;
  topicPool: TopicKey[];
  groups: ScheduleGroupTemplate[];
  batchesPerRun: number;
  tone: Tone;
  length: CaptionLength;
  startsAtUTC: string;
  timezone: string;
  recurrence: Recurrence;
  /** Inclusive end date in the schedule timezone (YYYY-MM-DD). */
  endDate: string | null;
  maxRuns: number | null;
  leadTimeHours: number | null;
  /** All regular occurrences at or before this instant have been handled (run or skipped). */
  handledThroughUTC: string | null;
  regularRunCount: number;
  createdAt: string;
  updatedAt: string;
  /** Set for one-time "Create later" draft requests from the simplified Create Post screen. */
  createLater?: { text: string; platforms: Platform[]; mode: 'same' | 'different' };
}

export interface GenerationRun {
  id: string;
  scheduleId: string;
  occurrenceKey: string;
  scheduledAt: string;
  startedAt: string;
  manual: boolean;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  campaignIds: string[];
  note: string;
}

export interface ActivityEvent {
  id: string;
  type: string;
  actor: string;
  entityId: string;
  timestamp: string;
  summary: string;
}

export interface AppNotification {
  id: string;
  at: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export type FailureKind = 'none' | 'clear' | 'transient' | 'ambiguous' | 'reconnect';

export interface PreviewSettings {
  role: Role;
  clockOffsetMs: number;
  /** One-shot simulated failure applied to the next matching publication. */
  failure: { kind: FailureKind; destinationId: string | 'any' };
  seedVersion: number;
  seededAtUTC: string;
  /** Last demo-clock instant at which the scheduler ran while the app was open. */
  lastActiveAtUTC: string;
  missedPromptDismissed: boolean;
  /** One-shot simulated generation failure (to demonstrate the retry path). */
  failGenerationNext: boolean;
}

export interface Cursors {
  caption: Record<string, number>;
  hashtag: Record<string, number>;
  image: Record<string, number>;
}

export interface AppData {
  schemaVersion: number;
  brand: BrandProfile;
  destinations: Record<string, Destination>;
  campaigns: Record<string, Campaign>;
  groups: Record<string, ContentGroup>;
  revisions: Record<string, ContentRevision>;
  media: Record<string, MediaAsset>;
  approvals: Record<string, Approval>;
  deliveries: Record<string, Delivery>;
  schedules: Record<string, GenerationSchedule>;
  runs: Record<string, GenerationRun>;
  activity: ActivityEvent[];
  notifications: AppNotification[];
  preview: PreviewSettings;
  cursors: Cursors;
  /** Simulated platform-side receipt ledger used to resolve ambiguous timeouts. */
  mockPlatformLedger: Record<string, string>;
}
