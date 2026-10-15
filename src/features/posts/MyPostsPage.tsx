import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, SquarePen } from 'lucide-react';
import { act, resetWorkspace, toast, useStore } from '../../store/store';
import { cancelCreateLater, pendingCreateLater, postRows, type PostStatus } from '../../domain/simplePosts';
import { PLATFORM_LABEL } from '../../domain/rules';
import { browserZone } from '../../domain/recurrence';
import { runDraftRequest } from '../../services/scheduler';
import { SEED_VERSION } from '../../fixtures/seed';
import { fmt } from '../../components/time';
import { Dialog, useConfirm } from '../../components/ui';
import { PostEditorCard, PostViewCard } from '../post/PostCards';

const TABS: { key: string; status: Exclude<PostStatus, 'hidden'>; label: string; empty: string }[] = [
  { key: 'approval', status: 'needs_approval', label: 'Needs approval', empty: 'Nothing needs approval — create a post to get started.' },
  { key: 'scheduled', status: 'scheduled', label: 'Scheduled', empty: 'No scheduled posts — approve a post and choose Schedule for later.' },
  { key: 'posted', status: 'posted', label: 'Posted', empty: 'Nothing posted yet — approve a post and choose Post now.' },
];

function DraftsToCreateLater() {
  const data = useStore((s) => s.data);
  const missed = useStore((s) => s.missedLater);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const zone = browserZone();
  const requests = pendingCreateLater(data);
  if (requests.length === 0) return null;
  return (
    <section className="later-list card" aria-labelledby="later-title">
      <h2 id="later-title">Drafts to create later</h2>
      <ul>
        {requests.map((s) => {
          const isMissed = missed.includes(s.id);
          const platforms = s.createLater?.platforms ?? [];
          return (
            <li key={s.id}>
              <Clock size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--muted)' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ overflowWrap: 'anywhere' }}>{s.name}</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  {isMissed ? (
                    <span style={{ color: 'var(--error)', fontWeight: 600 }}>The time ({fmt(s.startsAtUTC, zone, 'ccc d LLL, HH:mm')}) passed while this preview was closed.</span>
                  ) : (
                    `Creates ${fmt(s.startsAtUTC, zone, 'ccc d LLL, HH:mm')}`
                  )}{' '}
                  · {platforms.map((p) => PLATFORM_LABEL[p]).join(', ')}
                </span>
              </span>
              {isMissed ? (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy === s.id}
                  onClick={async () => {
                    setBusy(s.id);
                    const id = await runDraftRequest(s.id);
                    setBusy(null);
                    if (id) {
                      toast('Draft created. Review it below.', 'success');
                      navigate('/posts?tab=approval');
                    }
                  }}
                >
                  Create draft now
                </button>
              ) : null}
              <button className="btn btn-sm" onClick={() => act((d, c) => cancelCreateLater(d, c, s.id))}>
                Cancel
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function MyPostsPage() {
  const data = useStore((s) => s.data);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const rows = useMemo(() => postRows(data), [data]);
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];
  const shown = rows.filter((r) => r.state.status === tab.status);
  const legacy = data.preview.seedVersion < SEED_VERSION;

  return (
    <div className="my-posts">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 className="page-title-lg" style={{ margin: 0 }}>
          My Posts
        </h1>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          <SquarePen size={16} /> Create Post
        </button>
      </div>

      <DraftsToCreateLater />

      <div className="tabs" role="tablist" aria-label="Post status">
        {TABS.map((t) => {
          const n = rows.filter((r) => r.state.status === t.status).length;
          return (
            <button key={t.key} role="tab" aria-selected={t.key === tab.key} onClick={() => setParams({ tab: t.key })}>
              {t.label} <span className="n">{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="empty-line">{tab.empty}</p>
      ) : (
        <div className="post-grid">
          {shown.map((r) =>
            tab.status === 'needs_approval' ? <PostEditorCard key={r.group.id} groupId={r.group.id} /> : <PostViewCard key={r.group.id} groupId={r.group.id} onEdit={setEditing} />,
          )}
        </div>
      )}

      {legacy && rows.length ? (
        <p className="small muted" style={{ marginTop: 28 }}>
          These include posts saved by the earlier, larger version of this demo.{' '}
          <button
            className="link-btn"
            onClick={async () => {
              const ok = await confirm({
                title: 'Replace with three simple examples?',
                body: <p>All posts saved in this preview (in this browser) will be removed and replaced with three examples: one needing approval, one scheduled and one posted.</p>,
                confirmLabel: 'Replace posts',
                tone: 'danger',
              });
              if (ok) {
                await resetWorkspace();
                toast('Replaced with three simple examples.', 'success');
              }
            }}
          >
            Replace them with three simple examples
          </button>
        </p>
      ) : null}

      {editing && data.groups[editing] ? (
        <Dialog wide title="Edit post" description="Changes need approval again before this post is published." onClose={() => setEditing(null)}>
          <PostEditorCard groupId={editing} />
        </Dialog>
      ) : null}
      {confirmNode}
    </div>
  );
}
