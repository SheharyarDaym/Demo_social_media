import { useEffect, useRef, useState } from 'react';
import { ImageOff, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useStore } from '../store/store';
import type { CropSettings, MediaAsset } from '../domain/types';
import { useMediaUrl, type Composition } from '../services/media';

export function useMedia(id: string | null | undefined): MediaAsset | undefined {
  return useStore((s) => (id ? s.data.media[id] : undefined));
}

/** Image renderer: bundled assets use their composition variant; uploads use fit/fill + focal point. */
export function MediaImage({
  mediaId,
  comp = 'portrait',
  crop,
  className,
  alt,
  style,
}: {
  mediaId: string | null | undefined;
  comp?: Composition;
  crop?: CropSettings;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}) {
  const asset = useMedia(mediaId);
  const isVideo = asset?.kind === 'video';
  const { url, missing } = useMediaUrl(asset, comp);
  if (!asset || missing) {
    return (
      <div className={className} style={{ ...style, display: 'grid', placeItems: 'center', background: '#dfe8f3', color: '#60758e', minHeight: 80 }} role="img" aria-label="Media unavailable">
        <ImageOff size={22} />
      </div>
    );
  }
  const src = isVideo ? asset.poster : url;
  if (!src) return <div className={`skeleton ${className ?? ''}`} style={style} role="status" aria-label="Loading image" />;
  const upload = asset.source === 'upload';
  const objectFit = upload && crop ? (crop.fit === 'fill' ? 'cover' : 'contain') : 'cover';
  const objectPosition = upload && crop ? `${crop.focalX}% ${crop.focalY}%` : 'center';
  return (
    <img
      src={src}
      alt={alt ?? asset.alt}
      className={className}
      style={{ objectFit, objectPosition, background: upload && crop?.fit === 'fit' ? '#062D5D' : undefined, ...style }}
      loading="lazy"
      draggable={false}
    />
  );
}

function fmtTime(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** Real playable local video with play/pause, time and mute controls. */
export function VideoPlayer({ mediaId, posterId, className, label }: { mediaId: string; posterId?: string | null; className?: string; label: string }) {
  const asset = useMedia(mediaId);
  const posterAsset = useMedia(posterId ?? null);
  const { url: posterUrl } = useMediaUrl(posterAsset, asset && asset.width > asset.height ? 'square' : 'story');
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(asset?.durationSec ?? 0);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [mediaId]);
  if (!asset || !asset.src) {
    return (
      <div className={className} style={{ display: 'grid', placeItems: 'center', color: '#fff' }}>
        Video unavailable
      </div>
    );
  }
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setError(true));
    else v.pause();
  };
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <video
        ref={ref}
        src={asset.src}
        poster={posterUrl ?? asset.poster ?? undefined}
        muted={muted}
        playsInline
        loop
        preload="metadata"
        aria-label={label}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        onError={() => setError(true)}
        onClick={toggle}
      />
      <div className="video-ctl">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause video' : 'Play video'} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (sample clip is silent)' : 'Mute'}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <span className="time" aria-live="off">
          {fmtTime(time)} / {fmtTime(dur)}
        </span>
      </div>
      {error ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', background: 'rgba(0,0,0,0.6)', padding: 12, textAlign: 'center', fontSize: 13 }}>
          This browser could not play the sample WebM clip.
        </div>
      ) : null}
    </div>
  );
}

