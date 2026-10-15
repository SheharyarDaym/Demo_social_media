import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, ImagePlus, Pencil, RefreshCw, Send, Upload, X as XIcon } from 'lucide-react';
import { toast, useStore } from '../../store/store';
import { uploadImage } from '../../store/mediaActions';
import { captionText, postState } from '../../domain/simplePosts';
import { DEMO_LIMITS, PLATFORM_LABEL, formatNeedsVideo } from '../../domain/rules';
import type { ContentGroup, Platform } from '../../domain/types';
import { xLength } from '../../domain/util';
import { platformsOf } from '../../domain/validation';
import type { Composition } from '../../services/media';
import { MediaImage, VideoPlayer } from '../../components/media';
import { PlatformIcon, useConfirm } from '../../components/ui';
import { fmt } from '../../components/time';
import { browserZone } from '../../domain/recurrence';
import { anotherImage, applyUploadedImage, blockingProblem, cancelSchedule, rewriteCaption, saveCaptionText } from './actions';
import { ApproveDialog } from './ApproveDialog';

function compFor(platforms: Platform[]): Composition {
  if (platforms.length !== 1) return 'portrait';
  if (platforms[0] === 'snapchat' || platforms[0] === 'tiktok') return 'story';
  if (platforms[0] === 'linkedin' || platforms[0] === 'x') return 'square';
  return 'portrait';
}

function PlatformBadges({ platforms }: { platforms: Platform[] }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {platforms.map((p) => (
        <span key={p} className="dest-mini">
          <PlatformIcon platform={p} small />
          {PLATFORM_LABEL[p]}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ g }: { g: ContentGroup }) {
  const data = useStore((s) => s.data);
  const st = postState(data, g);
  const zone = browserZone();
  if (st.status === 'posted') return <span className="badge b-approved">Posted in preview{st.postedAt ? ` · ${fmt(st.postedAt, zone, 'd LLL, HH:mm')}` : ''}</span>;
  if (st.status === 'scheduled')
    return st.needsTimeReview ? <span className="badge b-error">Posting time needs review</span> : <span className="badge b-info">Scheduled · {fmt(st.scheduledAt, zone, 'ccc d LLL, HH:mm')}</span>;
  return <span className="badge b-review">Needs approval</span>;
}

/** Image or video area. Image posts accept drag-and-drop uploads. */
function MediaArea({ groupId, editable }: { groupId: string; editable: boolean }) {
  const data = useStore((s) => s.data);
  const g = data.groups[groupId];
  const r = data.revisions[g.currentRevisionId];
  const [drag, setDrag] = useState(false);
  const platforms = platformsOf(data, g.destinationIds);
  const comp = compFor(platforms);
  const video = formatNeedsVideo(g.format);
  const onDrop = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const id = await uploadImage(f, data.campaigns[g.campaignId]?.title ?? '');
    if (id) {
      applyUploadedImage(groupId, id);
      toast(video ? 'Cover image updated.' : 'Image updated.', 'success');
    }
  };
  if (video) {
    const hasClip = r.mediaIds.some((id) => data.media[id]?.kind === 'video');
    return (
      <div className="post-media video">
        {hasClip ? (
          <VideoPlayer mediaId={r.mediaIds[0]} posterId={r.thumbnailMediaId} label="YouTube video preview" />
        ) : (
          <div className="no-video">Add a sample video to preview YouTube</div>
        )}
      </div>
    );
  }
  return (
    <div
      className={`post-media${drag ? ' drag' : ''}`}
      style={{ aspectRatio: comp === 'story' ? '9 / 16' : comp === 'square' ? '1 / 1' : '4 / 5' }}
      onDragOver={editable ? (e) => (e.preventDefault(), setDrag(true)) : undefined}
      onDragLeave={editable ? () => setDrag(false) : undefined}
      onDrop={
        editable
          ? (e) => {
              e.preventDefault();
              setDrag(false);
              void onDrop(e.dataTransfer.files);
            }
          : undefined
      }
    >
      <MediaImage mediaId={r.mediaIds[0]} comp={comp} crop={r.crop} style={{ width: '100%', height: '100%' }} />
      {drag ? <div className="drop-hint">Drop to use this image</div> : null}
    </div>
  );
}

function ChangeImageMenu({ groupId, video }: { groupId: string; video: boolean }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const campaignTitle = useStore((s) => s.data.campaigns[s.data.groups[groupId]?.campaignId]?.title ?? '');
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const label = video ? 'Change cover' : 'Change image';
  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ImagePlus size={16} /> {label} <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              anotherImage(groupId);
            }}
          >
            <RefreshCw size={15} /> Generate another
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
          >
            <Upload size={15} /> Upload image
          </button>
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        data-testid="upload-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const id = await uploadImage(f, campaignTitle);
          if (id) {
            applyUploadedImage(groupId, id);
            toast(video ? 'Cover image updated.' : 'Image updated.', 'success');
          }
        }}
      />
    </div>
  );
}

/** Caption + hashtags in one text area, saved automatically. */
function CaptionEditor({ groupId }: { groupId: string }) {
  const data = useStore((s) => s.data);
  const g = data.groups[groupId];
  const r = data.revisions[g.currentRevisionId];
  const stored = captionText(r.caption, r.hashtags);
  const [text, setText] = useState(stored);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(stored);
  // Follow external changes (Rewrite caption, another tab) when the user has no pending edit.
  useEffect(() => {
    if (!timer.current && stored !== lastSaved.current) {
      lastSaved.current = stored;
      setText(stored);
    }
  }, [stored]);
  const flush = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (value === lastSaved.current) return;
    lastSaved.current = value;
    saveCaptionText(groupId, value);
    setStatus('saved');
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    },
    [],
  );
  const platforms = platformsOf(data, g.destinationIds);
  const xLen = platforms.includes('x') ? xLength(text, [], r.ctaLink) : 0;
  return (
    <div className="field">
      <label htmlFor={`cap-${groupId}`} className="sr-only">
        Caption and hashtags
      </label>
      <textarea
        id={`cap-${groupId}`}
        className="textarea caption-box"
        value={text}
        rows={6}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          setStatus('saving');
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(v), 600);
        }}
        onBlur={() => flush(text)}
        data-flush
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`small${xLen > DEMO_LIMITS.xCaptionBudget ? '' : ' muted'}`} style={xLen > DEMO_LIMITS.xCaptionBudget ? { color: 'var(--error)', fontWeight: 650 } : undefined}>
          {platforms.includes('x') ? `X: ${xLen} of ${DEMO_LIMITS.xCaptionBudget} characters` : ''}
        </span>
        <span className="small muted" role="status" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
    </div>
  );
}

/** Editable card used on Create Post and in My Posts → Needs approval. */
export function PostEditorCard({ groupId, note }: { groupId: string; note?: string }) {
  const data = useStore((s) => s.data);
  const [approving, setApproving] = useState(false);
  const g = data.groups[groupId];
  if (!g) return null;
  const campaign = data.campaigns[g.campaignId];
  const platforms = platformsOf(data, g.destinationIds);
  const video = formatNeedsVideo(g.format);
  const problem = blockingProblem(groupId);
  return (
    <article className="post-card-simple card" aria-label={`${campaign.title}: ${platforms.map((p) => PLATFORM_LABEL[p]).join(', ')}`}>
      <MediaArea groupId={groupId} editable />
      <div className="post-body">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <PlatformBadges platforms={platforms} />
          <StatusPill g={g} />
        </div>
        {note ? <p className="small note">{note}</p> : null}
        {video && campaign.mode === 'same' ? <p className="small note">YouTube needs a video, so we prepared a video version.</p> : null}
        {platforms.length > 1 ? <p className="small note">Changes apply to all selected platforms.</p> : null}
        <CaptionEditor groupId={groupId} />
        {problem ? (
          <p className="small" role="alert" style={{ color: 'var(--error)', fontWeight: 600 }}>
            {problem}
          </p>
        ) : null}
        <div className="post-actions">
          <button className="btn" onClick={() => rewriteCaption(groupId)}>
            <RefreshCw size={16} /> Rewrite caption
          </button>
          <ChangeImageMenu groupId={groupId} video={video} />
          <button
            className="btn btn-primary"
            disabled={!!problem}
            title={problem ?? undefined}
            onClick={() => {
              // Save any pending text edit before approving the exact content.
              (document.activeElement as HTMLElement | null)?.blur();
              setApproving(true);
            }}
          >
            <Send size={16} /> Approve &amp; Post
          </button>
        </div>
      </div>
      {approving ? <ApproveDialog groupId={groupId} onClose={() => setApproving(false)} /> : null}
    </article>
  );
}

/** Read-only card for Scheduled and Posted. */
export function PostViewCard({ groupId, onEdit }: { groupId: string; onEdit: (groupId: string) => void }) {
  const data = useStore((s) => s.data);
  const [reviewTime, setReviewTime] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const g = data.groups[groupId];
  if (!g) return null;
  const r = data.revisions[g.currentRevisionId];
  const st = postState(data, g);
  const platforms = platformsOf(data, g.destinationIds);
  const zone = browserZone();
  return (
    <article className="post-card-simple card">
      <MediaArea groupId={groupId} editable={false} />
      <div className="post-body">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <PlatformBadges platforms={platforms} />
          <StatusPill g={g} />
        </div>
        <p className="caption-read">{captionText(r.caption, r.hashtags)}</p>
        {st.status === 'posted' ? (
          <p className="small muted">Posted in preview{st.postedAt ? ` on ${fmt(st.postedAt, zone, 'ccc d LLL, HH:mm')}` : ''}. Nothing was posted to a real account.</p>
        ) : null}
        {st.status === 'scheduled' && st.needsTimeReview ? (
          <p className="small" style={{ color: 'var(--error)', fontWeight: 600 }}>
            {st.deliveries.some((x) => x.status === 'blocked' && x.blockedReason === 'Scheduled time missed')
              ? 'The posting time passed while this preview was closed. Nothing was posted.'
              : 'Posting did not finish for every platform. Nothing was posted twice.'}
          </p>
        ) : null}
        {st.status === 'scheduled' ? (
          <div className="post-actions">
            {st.needsTimeReview ? (
              <button className="btn btn-primary" onClick={() => setReviewTime(true)}>
                <CalendarClock size={16} /> Review posting time
              </button>
            ) : null}
            <button className="btn" onClick={() => onEdit(groupId)}>
              <Pencil size={16} /> Edit
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Cancel this scheduled post?',
                  body: <p>It will not be posted. The post is kept under Needs approval so you can approve it again later.</p>,
                  confirmLabel: 'Cancel schedule',
                  cancelLabel: 'Keep schedule',
                  tone: 'danger',
                });
                if (ok) cancelSchedule(groupId);
              }}
            >
              <XIcon size={16} /> Cancel schedule
            </button>
          </div>
        ) : null}
      </div>
      {reviewTime ? <ApproveDialog groupId={groupId} title="Review posting time" onClose={() => setReviewTime(false)} /> : null}
      {confirmNode}
    </article>
  );
}
