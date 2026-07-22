import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { Run, STATUS_META, RUN_STATUS_ORDER } from '../lib/types';
import { StatusPill, StageStrip, MicroLabel } from '../components/ui';
import AuditModal from '../components/AuditModal';
import { fmtAgo, cap } from '../lib/format';

// Runs page (DESIGN_SPEC §5): stat cards, the runs table (exact grid columns),
// legend. Clicking a row opens the audit-trail modal — NOT the detail page.
// Admins can delete terminal (failed/complete/rejected) runs to clear clutter.

const GRID = '100px minmax(200px,1fr) 128px 96px 40px 68px 30px';
const DELETABLE = new Set(['failed', 'complete', 'rejected']);

export default function Runs() {
  const { runs, refreshRuns, showToast } = useApp();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [modalRun, setModalRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const delRun = async (e: React.MouseEvent, r: Run) => {
    e.stopPropagation(); // don't open the audit modal
    if (!window.confirm(`Delete ${r.wf}? This permanently removes the run and its history.`)) return;
    setBusy(r.id);
    try {
      await api.del(`/api/runs/${r.id}`);
      await refreshRuns();
      showToast(`${r.wf} deleted`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const clearFailed = async () => {
    const n = runs.filter((r) => r.status === 'failed').length;
    if (!n || !window.confirm(`Delete all ${n} failed run(s)? This cannot be undone.`)) return;
    setBusy('all');
    try {
      const res = await api.del<{ deleted: number }>('/api/runs');
      await refreshRuns();
      showToast(`Cleared ${res.deleted} failed run(s)`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Clear failed');
    } finally {
      setBusy(null);
    }
  };

  const nActive = runs.filter((r) => r.status === 'running').length;
  const nReview = runs.filter((r) => r.status === 'review' || r.status === 'distreview').length;
  const nFailed = runs.filter((r) => r.status === 'failed').length;
  const nDone = runs.filter((r) => r.status === 'complete').length;

  const sorted = [...runs].sort(
    (a, b) => RUN_STATUS_ORDER[a.status] - RUN_STATUS_ORDER[b.status] || b.createdAt - a.createdAt
  );

  const th = 80; // display coloring threshold; server enforces the real one

  const stats: Array<[string, number, string, string]> = [
    ['Active runs', nActive, 'var(--amb)', 'BullMQ · content-pipeline'],
    ['Awaiting review', nReview, 'var(--vio)', 'content + distribution gates'],
    ['Failed / parked', nFailed, nFailed > 0 ? 'var(--red)' : 'var(--tx)', 'manual retry available'],
    ['Completed', nDone, 'var(--grn)', 'Karbon notified']
  ];

  return (
    <div>
      {/* §5.1 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {stats.map(([label, value, color, sub]) => (
          <div key={label} className="card" style={{ padding: '14px 17px' }}>
            <MicroLabel>{label}</MicroLabel>
            <div className="disp" style={{ fontSize: 25, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
            <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Bulk clear (admin) */}
      {isAdmin && nFailed > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ padding: '5px 12px', fontSize: 11, color: 'var(--red)' }}
            disabled={busy === 'all'}
            onClick={clearFailed}
          >
            {busy === 'all' ? 'Clearing…' : `Clear ${nFailed} failed run${nFailed > 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* §5.2 runs table */}
      <div className="card" style={{ marginTop: 14, overflowX: 'auto' }}>
        <div style={{ minWidth: 740 }}>
          <div
            className="microlabel"
            style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--line2)' }}
          >
            <span>Run</span>
            <span>Topic · client</span>
            <span>Pipeline</span>
            <span>Status</span>
            <span>SEO</span>
            <span>Updated</span>
            <span />
          </div>
          {sorted.map((r) => (
            <div
              key={r.id}
              className="rowhover"
              onClick={() => setModalRun(r)}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: 12,
                padding: '13px 18px',
                borderBottom: '1px solid var(--line2)',
                alignItems: 'center',
                cursor: 'pointer'
              }}
            >
              <div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.wf}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{r.karbon}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cap(r.topic)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--tx3)' }}>{r.client}</div>
              </div>
              <StageStrip stages={r.stages} />
              <div><StatusPill status={r.status} /></div>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: r.seo ? (r.seo.total >= th ? 'var(--grn)' : 'var(--amb)') : 'var(--tx4)' }}>
                {r.seo ? r.seo.total : '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--tx2)' }}>{fmtAgo(r.updatedAt)}</span>
              {isAdmin && DELETABLE.has(r.status) ? (
                <button
                  title={`Delete ${r.wf}`}
                  aria-label={`Delete ${r.wf}`}
                  className="rowdel"
                  disabled={busy === r.id}
                  onClick={(e) => delRun(e, r)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx4)', fontSize: 14, padding: 2, lineHeight: 1 }}
                >
                  {busy === r.id ? '…' : '🗑'}
                </button>
              ) : (
                <span style={{ color: 'var(--tx4)' }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* §5.3 legend */}
      <div className="mono" style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: 'var(--tx3)', flexWrap: 'wrap' }}>
        {[
          ['done', 'var(--grn)'],
          ['running', 'var(--ambH)'],
          ['review gate', 'var(--vio)'],
          ['partial', 'var(--amb2)'],
          ['failed', 'var(--red)'],
          ['pending/skipped', 'var(--skip)']
        ].map(([label, c]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} /> {label}
          </span>
        ))}
      </div>

      {modalRun && <AuditModal run={runs.find((r) => r.id === modalRun.id) ?? modalRun} onClose={() => setModalRun(null)} />}
    </div>
  );
}
