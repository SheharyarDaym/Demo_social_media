import { useState } from 'react';
import { CalendarClock, Send } from 'lucide-react';
import { useStore } from '../../store/store';
import { PLATFORM_LABEL } from '../../domain/rules';
import { browserZone } from '../../domain/recurrence';
import { DateTimeInput, useNow, zoneLabel } from '../../components/time';
import { Dialog, PlatformIcon } from '../../components/ui';
import { approveAndPost } from './actions';

function defaultLater(now: Date): string {
  const t = new Date(now.getTime() + 2 * 3_600_000);
  t.setMinutes(0, 0, 0);
  return t.toISOString();
}

export function ApproveDialog({ groupId, onClose, title = 'Approve & Post' }: { groupId: string; onClose: () => void; title?: string }) {
  const data = useStore((s) => s.data);
  const now = useNow();
  const zone = browserZone();
  const g = data.groups[groupId];
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState<string | null>(defaultLater(now));
  const [busy, setBusy] = useState(false);
  if (!g) return null;
  const posted = new Set(
    Object.values(data.deliveries)
      .filter((x) => x.groupId === groupId && x.revisionId === g.currentRevisionId && x.status === 'published_preview')
      .map((x) => x.destinationId),
  );
  const targets = g.destinationIds.filter((id) => !posted.has(id));
  const past = when === 'later' && (!at || new Date(at).getTime() <= now.getTime());
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await approveAndPost(groupId, when === 'now' ? { now: true } : { now: false, at: at! });
    if (ok) onClose();
    else setBusy(false);
  };
  return (
    <Dialog
      title={title}
      description="You are approving exactly what is shown in this post."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void confirm()} disabled={busy || past || targets.length === 0} data-autofocus>
            {when === 'now' ? <Send size={16} /> : <CalendarClock size={16} />}
            {busy ? 'Working…' : when === 'now' ? 'Approve & Post Now' : 'Approve & Schedule'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Posting to</span>
          <div className="row" style={{ gap: 6 }}>
            {targets.map((id) => {
              const p = data.destinations[id].platform;
              return (
                <span key={id} className="dest-mini" style={{ fontSize: 14, padding: '4px 12px 4px 4px' }}>
                  <PlatformIcon platform={p} small /> {PLATFORM_LABEL[p]}
                </span>
              );
            })}
          </div>
          {posted.size ? <span className="hint">Already posted to {[...posted].map((id) => PLATFORM_LABEL[data.destinations[id].platform]).join(', ')} — those are not posted again.</span> : null}
        </div>
        <div className="when-options" role="radiogroup" aria-label="When should it be posted?">
          <button type="button" role="radio" aria-checked={when === 'now'} className="when-option" onClick={() => setWhen('now')}>
            <span className="radio" aria-hidden="true" />
            <span>
              <strong>Post now</strong>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={when === 'later'} className="when-option" onClick={() => setWhen('later')}>
            <span className="radio" aria-hidden="true" />
            <span>
              <strong>Schedule for later</strong>
            </span>
          </button>
        </div>
        {when === 'later' ? (
          <div className="field">
            <label htmlFor="post-at">Posting time</label>
            <DateTimeInput id="post-at" label="Posting time" value={at} zone={zone} onChange={setAt} invalid={past} />
            <span className="hint">Your time zone: {zoneLabel(zone)}</span>
            {past ? <span className="small" style={{ color: 'var(--error)' }}>Choose a time in the future.</span> : null}
          </div>
        ) : null}
        <p className="preview-only">Preview only — no real posts are published.</p>
      </div>
    </Dialog>
  );
}
