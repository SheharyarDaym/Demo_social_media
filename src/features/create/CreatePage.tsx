import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, CheckCircle2, Circle, Clock, Sparkles } from 'lucide-react';
import { act, toast, useStore } from '../../store/store';
import { PLATFORMS, PLATFORM_LABEL } from '../../domain/rules';
import type { Platform } from '../../domain/types';
import { addCreateLater, createPost, TOPIC_EXAMPLE, type PostMode } from '../../domain/simplePosts';
import { browserZone } from '../../domain/recurrence';
import { GENERATION_STEPS, GenerationCancelled, stagedProgress } from '../../services/generator';
import { DateTimeInput, useNow, zoneLabel } from '../../components/time';
import { Dialog, PlatformIcon } from '../../components/ui';
import { PostEditorCard } from '../post/PostCards';

function CreateLaterDialog({ text, platforms, mode, onClose }: { text: string; platforms: Platform[]; mode: PostMode; onClose: () => void }) {
  const now = useNow();
  const zone = browserZone();
  const [at, setAt] = useState<string | null>(() => {
    const t = new Date(now.getTime() + 3_600_000);
    t.setMinutes(0, 0, 0);
    return new Date(t.getTime() + 3_600_000).toISOString();
  });
  const [saving, setSaving] = useState(false);
  const past = !at || new Date(at).getTime() <= now.getTime();
  return (
    <Dialog
      title="When should we create your draft?"
      description="You will review it before it is posted."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={past || saving}
            onClick={() => {
              setSaving(true);
              act((d, c) => addCreateLater(d, c, at!, { text, platforms, mode }, zone));
              toast('Draft request saved. It will appear in My Posts.', 'success', { label: 'My Posts', href: '/posts' });
              onClose();
            }}
          >
            <Clock size={16} /> Create draft later
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="later-at">Create the draft on</label>
          <DateTimeInput id="later-at" label="Create the draft on" value={at} zone={zone} onChange={setAt} invalid={past} />
          <span className="hint">Your time zone: {zoneLabel(zone)}</span>
          {past ? <span className="small" style={{ color: 'var(--error)' }}>Choose a time in the future.</span> : null}
        </div>
        <p className="small muted">
          Topic: “{text}” · {platforms.map((p) => PLATFORM_LABEL[p]).join(', ')} · {mode === 'same' ? 'Same post' : 'Different posts'}
        </p>
        <p className="small muted">Keep this preview open for scheduled actions.</p>
      </div>
    </Dialog>
  );
}

export default function CreatePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const data = useStore((s) => s.data);
  const [platforms, setPlatforms] = useState<Platform[]>(['facebook', 'instagram']);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<PostMode>('same');
  const [step, setStep] = useState<number | null>(null);
  const [later, setLater] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const campaignId = params.get('c');
  const campaign = campaignId ? data.campaigns[campaignId] : undefined;

  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = (p: Platform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || cur.includes(x))));
  const topic = text.trim() || TOPIC_EXAMPLE;

  const generate = async () => {
    if (platforms.length === 0 || step !== null) return;
    if (!text.trim()) setText(TOPIC_EXAMPLE);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStep(0);
    try {
      // Staged progress only; content comes from prepared local variations.
      await stagedProgress(2000, ctrl.signal, setStep);
      const created = act((d, c) => createPost(d, c, { text: topic, platforms, mode }));
      setParams({ c: created.id });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      if (!(e instanceof GenerationCancelled)) toast('Something went wrong. Nothing was saved — try again.', 'error');
    } finally {
      setStep(null);
      abortRef.current = null;
    }
  };

  const groups = campaign ? campaign.groupIds.map((id) => data.groups[id]).filter(Boolean) : [];

  return (
    <div className="create">
      <h1 className="page-title-lg">Create a post</h1>

      <section className="step card" aria-labelledby="s1">
        <h2 id="s1">
          <span className="step-num">1</span> Where do you want to post?
        </h2>
        <div className="row" style={{ gap: 8 }} role="group" aria-label="Platforms">
          {PLATFORMS.map((p) => {
            const on = platforms.includes(p);
            return (
              <button key={p} type="button" className="pchip" aria-pressed={on} onClick={() => toggle(p)}>
                <span className="tick" aria-hidden="true">{on ? <Check size={12} /> : null}</span>
                <PlatformIcon platform={p} />
                {PLATFORM_LABEL[p]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="step card" aria-labelledby="s2">
        <h2 id="s2">
          <span className="step-num">2</span> What should the post be about?
        </h2>
        <label htmlFor="topic" className="sr-only">
          Post topic
        </label>
        <textarea id="topic" className="textarea" rows={3} placeholder={TOPIC_EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mode-choice" role="radiogroup" aria-label="Same or different posts">
          <button type="button" role="radio" aria-checked={mode === 'same'} className="when-option" onClick={() => setMode('same')}>
            <span className="radio" aria-hidden="true" />
            <span>
              <strong>Same post</strong>
              <span className="muted small">Use the same caption and image on the selected platforms.</span>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'different'} className="when-option" onClick={() => setMode('different')}>
            <span className="radio" aria-hidden="true" />
            <span>
              <strong>Different posts</strong>
              <span className="muted small">Create a separate version for each platform.</span>
            </span>
          </button>
        </div>
      </section>

      <section className="step step-generate" aria-labelledby="s3">
        <h2 id="s3" className="sr-only">
          Generate
        </h2>
        {step === null ? (
          <div className="generate-row">
            <button className="btn btn-primary btn-xl" onClick={() => void generate()} disabled={platforms.length === 0} title={platforms.length === 0 ? 'Choose at least one platform' : undefined}>
              <Sparkles size={20} /> Generate Post
            </button>
            <button className="link-btn" onClick={() => setLater(true)} disabled={platforms.length === 0}>
              <Clock size={15} /> Create later
            </button>
          </div>
        ) : (
          <div className="progress card" role="status" aria-live="polite">
            {GENERATION_STEPS.map((s, i) => (
              <span key={s} className={`gen-step${i < step ? ' done' : i === step ? ' active' : ''}`}>
                {i < step ? <CheckCircle2 size={16} /> : i === step ? <span className="spinner" aria-hidden="true" /> : <Circle size={16} />}
                {s}
              </span>
            ))}
            <button className="link-btn" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </div>
        )}
        {platforms.length === 0 ? <p className="small muted">Choose at least one platform.</p> : null}
      </section>

      {campaign && groups.length ? (
        <section className="result" ref={resultRef} aria-labelledby="result-title">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="result-title">Review your post</h2>
            <span className="small muted">
              Saved to <Link to="/posts">My Posts</Link> as Needs approval ·{' '}
              <button
                className="link-btn"
                onClick={() => {
                  navigate('/', { replace: true });
                  setText('');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Start a new post
              </button>
            </span>
          </div>
          <div className={`post-grid${groups.length === 1 ? ' single' : ''}`}>
            {groups.map((g) => (
              <PostEditorCard key={g.id} groupId={g.id} />
            ))}
          </div>
        </section>
      ) : campaignId ? (
        <p className="small muted">This post is no longer available. Generate a new one above.</p>
      ) : null}

      {later ? <CreateLaterDialog text={topic} platforms={platforms} mode={mode} onClose={() => setLater(false)} /> : null}
    </div>
  );
}
