import { useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { Run, ACCT_STATUS, STATUS_META } from '../lib/types';
import { MicroLabel, StatusPill, Toggle } from '../components/ui';
import AuditModal from '../components/AuditModal';
import { fmtAgo } from '../lib/format';

// Archive page (DESIGN_SPEC §8.4): final review gateway (bulk approve),
// filter pills + search, content cards grid.

const FILTERS = ['All', ACCT_STATUS, 'Published', 'In progress', 'Failed'];

export default function Archive() {
  const { runs, showToast, refreshRuns } = useApp();
  const { user, canApprove } = useAuth();
  const [filter, setFilter] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [modalRun, setModalRun] = useState<Run | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoOn, setAutoOn] = useState<boolean | null>(null);

  const acct = runs.filter((r) => r.status === 'review');
  const selIds = Object.keys(sel).filter((id) => sel[id]);
  const th = 80;

  useMemo(() => {
    api.get<{ settings: { auto_approve_enabled?: boolean } }>('/api/settings').then((r) =>
      setAutoOn(r.settings.auto_approve_enabled === true)
    );
    return null;
  }, []);

  const toggleAuto = async () => {
    if (user?.role !== 'admin') return showToast('Only admins can change workflow gates');
    setAutoBusy(true);
    const next = !autoOn;
    await api.put('/api/settings/auto_approve_enabled', { value: next }).catch(() => undefined);
    setAutoOn(next);
    setAutoBusy(false);
  };

  const conflictToast = (err: unknown, fallbackWf: string, template: (wf: string, who: string) => string) => {
    if (err instanceof ApiError && err.status === 409) {
      showToast(template((err.data.runId as string) || fallbackWf, (err.data.who as string) || 'another user'));
      return true;
    }
    return false;
  };

  const approveOne = async (r: Run) => {
    if (!canApprove) return showToast('Editor role can’t approve — admin or reviewer required');
    try {
      await api.post(`/api/runs/${r.id}/approve`);
      showToast(`${r.wf} approved (was “${ACCT_STATUS}”) → deploy queued`);
      setSel((s) => ({ ...s, [r.id]: false }));
      await refreshRuns();
    } catch (err) {
      conflictToast(err, r.wf, (wf, who) => `${wf} was already approved by ${who} — nothing overwritten`);
    }
  };

  const bulkApprove = async () => {
    if (!canApprove) return showToast('Editor role can’t approve — admin or reviewer required');
    let n = 0;
    for (const id of selIds) {
      try {
        await api.post(`/api/runs/${id}/approve`);
        n++;
      } catch {
        /* conflicts skip silently in bulk */
      }
    }
    setSel({});
    showToast(`${n} item${n === 1 ? '' : 's'} approved → deploy queued`);
    await refreshRuns();
  };

  const remakeOne = async (r: Run) => {
    try {
      await api.post(`/api/runs/${r.id}/remake`);
      showToast(`${r.wf} sent back — regenerating from scratch`);
      await refreshRuns();
    } catch (err) {
      conflictToast(err, r.wf, (wf, who) => `${wf} was already handled by ${who} — remake not sent`);
    }
  };

  const rejectOne = async (r: Run) => {
    if (!canApprove) return showToast('Editor role can’t reject — admin or reviewer required');
    try {
      await api.post(`/api/runs/${r.id}/reject`);
      showToast(`${r.wf} rejected by ${user!.handle} — run discarded`);
      await refreshRuns();
    } catch (err) {
      conflictToast(err, r.wf, (wf, who) => `${wf} was already handled by ${who} — nothing overwritten`);
    }
  };

  const match = (r: Run) => {
    const needle = q.toLowerCase();
    if (needle && ![r.topic, r.client, r.painPoint ?? '', r.draft?.title ?? ''].some((s) => s.toLowerCase().includes(needle))) return false;
    if (filter === 'All') return true;
    if (filter === ACCT_STATUS) return r.status === 'review';
    if (filter === 'Published') return r.status === 'complete';
    if (filter === 'Failed') return r.status === 'failed';
    return r.status === 'running' || r.status === 'distreview';
  };
  const cards = runs.filter(match);

  return (
    <div>
      {/* final review gateway */}
      <div className="card" style={{ padding: '15px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <MicroLabel style={{ color: 'var(--vio)' }}>Final review gateway</MicroLabel>
          <span className="pill" style={{ color: 'var(--vio)', background: 'rgba(91,79,194,.11)' }}>{ACCT_STATUS}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 11.5, fontWeight: 500 }}>{autoOn ? 'Auto-approve & distribute' : 'Manual review (default)'}</span>
            <Toggle on={!!autoOn} onClick={toggleAuto} disabled={autoBusy || user?.role !== 'admin'} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 6, lineHeight: 1.55 }}>
          {autoOn
            ? `Auto-approve ON — content scoring ≥ ${th} clears this gate automatically. The distribution gate always needs a human.`
            : 'Manual review ON — every item waits for a human. Toggle to auto-approve above the SEO threshold.'}
        </div>

        {acct.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--tx3)', marginTop: 12 }}>
            No items in “{ACCT_STATUS}” — nothing awaiting accountant sign-off.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, flexWrap: 'wrap' }}>
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 11px', fontSize: 11.5 }}
                onClick={() =>
                  setSel(selIds.length === acct.length ? {} : Object.fromEntries(acct.map((r) => [r.id, true])))
                }
              >
                {selIds.length === acct.length ? 'Clear all' : 'Select all'}
              </button>
              <button className={`btn btn-primary ${!canApprove ? 'btn-editor-dim' : ''}`} style={{ padding: '6px 13px', fontSize: 11.5 }} onClick={bulkApprove} disabled={selIds.length === 0 && canApprove}>
                {selIds.length ? `Manual Approve (${selIds.length})` : 'Manual Approve selected'}
              </button>
              <span style={{ fontSize: 10.5, color: 'var(--tx3)' }}>Bulk or individual — every approval is logged with your user id.</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {acct.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: '1px solid var(--line2)' }}>
                  <button
                    onClick={() => setSel((s) => ({ ...s, [r.id]: !s[r.id] }))}
                    style={{ width: 19, height: 19, borderRadius: 5, flexShrink: 0, cursor: 'pointer', border: `1px solid ${sel[r.id] ? 'var(--grn)' : 'var(--line5)'}`, background: sel[r.id] ? 'var(--grn)' : 'transparent', color: '#fff', fontSize: 12, lineHeight: 1 }}
                  >
                    {sel[r.id] ? '✓' : ''}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.draft?.title ?? r.topic}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 2 }}>
                      {r.wf} · {r.client} · {r.seoLoops ? `passed after ${r.seoLoops} auto-SEO loop${r.seoLoops > 1 ? 's' : ''}` : 'passed SEO on first pass'}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: (r.seo?.total ?? 0) >= th ? 'var(--grn)' : 'var(--amb)' }}>
                    {r.seo?.total ?? '—'}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--tx4)' }}>
                    waited {fmtAgo(r.stages[4]?.startedAt ?? r.updatedAt).replace(' ago', '')}
                  </span>
                  <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => remakeOne(r)}>Remake</button>
                  <button className={`btn btn-red ${!canApprove ? 'btn-editor-dim' : ''}`} style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => rejectOne(r)}>Reject</button>
                  <button
                    className={`btn ${!canApprove ? 'btn-editor-dim' : ''}`}
                    style={{ padding: '5px 12px', fontSize: 11, border: '1px solid var(--grn)', color: 'var(--grn)', background: 'transparent' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--grn)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--grn)'; }}
                    onClick={() => approveOne(r)}
                  >
                    Approve
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* filters + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="pill"
            style={{ cursor: 'pointer', border: '1px solid var(--line4)', background: filter === f ? 'var(--tx)' : 'var(--bg3)', color: filter === f ? 'var(--bg2)' : 'var(--tx2)' }}
          >
            {f}
          </button>
        ))}
        <input
          className="nf-input"
          placeholder="Search topic, client, pain point…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginLeft: 'auto', width: 260 }}
        />
      </div>

      {cards.length === 0 && <div style={{ padding: '36px 0', fontSize: 12, color: 'var(--tx3)' }}>No content matches.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12, marginTop: 12 }}>
        {cards.map((r) => (
          <div key={r.id} className="card rowhover" style={{ padding: '14px 17px', cursor: 'pointer' }} onClick={() => setModalRun(r)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{r.wf}</span>
              <span style={{ marginLeft: 'auto' }}>
                <StatusPill status={r.status} labelOverride={r.status === 'review' ? ACCT_STATUS : undefined} />
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, marginTop: 8, lineHeight: 1.45 }}>{r.draft?.title ?? r.topic}</div>
            <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 3 }}>{r.client}</div>
            {r.painPoint && (
              <div style={{ fontSize: 11, color: 'var(--tx2)', borderLeft: '2px solid var(--line4)', paddingLeft: 9, marginTop: 8, lineHeight: 1.5 }}>
                {r.painPoint}
              </div>
            )}
            <div className="mono" style={{ display: 'flex', gap: 10, fontSize: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ color: r.seo ? ((r.seo.total >= th) ? 'var(--grn)' : 'var(--amb)') : 'var(--tx4)' }}>
                SEO {r.seo ? `${r.seo.total}/100` : '—'}
              </span>
              <span style={{ color: 'var(--tx3)' }}>{r.draft?.words ? `${r.draft.words.toLocaleString('en-US')} words` : 'not generated'}</span>
              <span style={{ color: 'var(--tx4)' }}>{fmtAgo(r.updatedAt)}</span>
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 6 }}>
              {r.artifacts.social ?? (r.status === 'complete' ? 'blog · LinkedIn · FB · IG · magnet' : r.artifacts.blogUrl ? 'blog · LinkedIn · FB · IG · magnet' : '—')}
            </div>
          </div>
        ))}
      </div>

      {modalRun && <AuditModal run={runs.find((x) => x.id === modalRun.id) ?? modalRun} onClose={() => setModalRun(null)} />}
    </div>
  );
}
