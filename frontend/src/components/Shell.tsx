import { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../lib/api';

// App shell (DESIGN_SPEC §3): 218px fixed sidebar that NEVER themes, 58px
// header with the exact title pairs, queue chip, theme toggle and the
// Simulate Karbon trigger button, top-center toast.

const NAV = [
  { key: 'runs', path: '/runs', label: 'Runs', num: '01' },
  { key: 'orchestrator', path: '/orchestrator', label: 'Orchestrator', num: '02' },
  { key: 'review', path: '/review', label: 'Review queue', num: '03' },
  { key: 'archive', path: '/archive', label: 'Archive', num: '04' },
  { key: 'magnets', path: '/magnets', label: 'Lead magnets', num: '05' },
  { key: 'registry', path: '/registry', label: 'Registry', num: '06' },
  { key: 'conns', path: '/connections', label: 'Connections', num: '07' },
  { key: 'settings', path: '/settings', label: 'Settings', num: '08' }
];

const TITLES: Record<string, [string, string]> = {
  runs: ['Workflow runs', 'Karbon-triggered pipelines · click a run for its BullMQ job log'],
  run: ['Run detail', 'Stage-by-stage saga state, artifacts and audit trail'],
  orchestrator: ['Prompt & Orchestrator', 'Master research prompt, target pain point and the auto-runner schedule'],
  review: ['Review queue', 'Auto-SEO loop → two human gates: content draft, then distribution'],
  archive: ['Content archive', 'Every asset the system has produced · final review gateway'],
  magnets: ['Lead magnets', 'Every downloadable PDF the system has produced · preview, live URL and leads captured'],
  registry: ['Uniqueness registry', 'SHA-256 exact + TF-IDF cosine · no repeat content is ever permitted'],
  conns: ['Connected accounts', 'Adapter credentials · tokens encrypted at rest (AES-256-GCM)'],
  settings: ['Settings', 'Gates, brand voice, trigger config and adapters']
};

function viewKey(pathname: string): string {
  if (pathname.startsWith('/runs/')) return 'run';
  const seg = pathname.split('/')[1] || 'runs';
  return seg === 'connections' ? 'conns' : seg;
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user, initials, logout } = useAuth();
  const { runs, toast, showToast, dark, toggleDark, refreshRuns } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const view = viewKey(loc.pathname);
  const [title, subtitle] = TITLES[view] ?? TITLES.runs;

  const reviewCount = runs.filter((r) => r.status === 'review' || r.status === 'distreview').length;
  const acctCount = runs.filter((r) => r.status === 'review').length;
  const nActive = runs.filter((r) => r.status === 'running').length;

  const simulate = async () => {
    try {
      const r = await api.post<{ duplicate: boolean; workItemId: string; wfIds: string[] }>('/api/simulate-trigger');
      if (r.duplicate) {
        showToast(`Duplicate delivery → idem:${r.workItemId}:mkt-ready already set · batch NOT re-triggered`);
      } else {
        showToast(`Webhook received · HMAC ✓ → ${r.wfIds.length} content sets queued (${r.wfIds.join(' · ')}) — one WorkflowRun per set`);
      }
      await refreshRuns();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        showToast('Editor role can’t trigger runs — admin or reviewer required');
      } else {
        showToast('Trigger failed — check the server logs');
      }
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ── Sidebar — 218px, never themes (§3.1) ── */}
      <aside
        style={{
          width: 218,
          flexShrink: 0,
          background: '#15181B',
          color: '#E9E7E1',
          padding: '18px 12px 14px',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div
            className="disp"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'var(--grn)',
              color: '#F4F2ED',
              fontWeight: 700,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            N
          </div>
          <div>
            <div className="disp" style={{ fontWeight: 700, fontSize: 14.5 }}>Propago</div>
            <div className="mono" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.14em', color: '#8B8FA0' }}>
              marketing ops
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, marginTop: 10 }}>
          {NAV.map((n) => {
            const active = view === n.key || (n.key === 'runs' && view === 'run');
            const badge = n.key === 'review' ? reviewCount : n.key === 'archive' ? acctCount : 0;
            return (
              <button
                key={n.key}
                onClick={() => nav(n.path)}
                onMouseEnter={(e) => !active && (e.currentTarget.style.background = 'rgba(255,255,255,.08)')}
                onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '9px 10px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? 'rgba(255,255,255,.1)' : 'transparent',
                  color: active ? '#F4F2ED' : '#A7ABB8',
                  fontWeight: active ? 600 : 400,
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                  textAlign: 'left'
                }}
              >
                <span className="mono" style={{ fontSize: 10, color: active ? '#2FBF8F' : '#5A5F6E' }}>{n.num}</span>
                <span style={{ flex: 1 }}>{n.label}</span>
                {badge > 0 && (
                  <span
                    className="mono"
                    style={{ background: 'var(--vio)', color: '#fff', fontSize: 10, borderRadius: 99, padding: '1px 7px' }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ border: '1px dashed rgba(255,255,255,.18)', borderRadius: 8, padding: '10px 11px', marginBottom: 10 }}>
          <div className="mono" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.1em', color: '#D9A03F' }}>
            ● sandbox mode
          </div>
          <div style={{ fontSize: 10.5, color: '#8B8FA0', lineHeight: 1.55, marginTop: 5 }}>
            Meta Ads + Karbon webhook run against sandbox until app review clears.
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 7, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'var(--vio)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 600,
              flexShrink: 0
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.firstName} {user?.lastName}
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: '#8B8FA0' }}>Marketing · {user?.role}</div>
          </div>
          <button
            onClick={() => logout().then(() => nav('/login'))}
            className="mono"
            style={{
              fontSize: 8.5,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,.22)',
              color: '#A7ABB8',
              borderRadius: 6,
              padding: '4px 7px',
              cursor: 'pointer'
            }}
          >
            log out
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: 58,
            flexShrink: 0,
            background: 'var(--bg2)',
            borderBottom: '1px solid var(--line4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px'
          }}
        >
          <div>
            <div className="disp" style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--tx3)' }}>{subtitle}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                background: 'var(--bg5)',
                border: '1px solid var(--line4)',
                borderRadius: 99,
                padding: '5px 11px',
                color: 'var(--tx2)'
              }}
            >
              BullMQ · active {nActive}
            </span>
            <button
              title="Toggle dark mode"
              onClick={toggleDark}
              style={{
                width: 34,
                height: 34,
                borderRadius: 7,
                border: '1px solid var(--line5)',
                background: 'transparent',
                color: 'var(--tx1)',
                fontSize: 15,
                cursor: 'pointer'
              }}
            >
              {dark ? '☼' : '☾'}
            </button>
            <button
              className="btn btn-primary"
              onClick={simulate}
              title="Posts a signed webhook — each trigger queues exactly 3 content sets (blog + lead magnet + distribution)"
            >
              Simulate Karbon trigger
            </button>
          </div>
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: '22px 24px 40px' }}>{children}</main>
      </div>

      {/* ── Toast (§3.4) ── */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            background: '#15181B',
            color: '#E9E7E1',
            borderRadius: 8,
            padding: '10px 18px',
            border: '1px solid rgba(255,255,255,.14)',
            boxShadow: '0 10px 28px rgba(20,18,12,.28)',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            animation: 'nfToastIn .25s ease',
            maxWidth: '80vw'
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2FBF8F', flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 11.5 }}>{toast}</span>
        </div>
      )}
    </div>
  );
}
