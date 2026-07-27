import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

// Connections page (DESIGN_SPEC §8.7): the 9 provider cards with env-derived
// status and a real authenticated Test call per provider.

interface Conn {
  id: string;
  glyph: string;
  gbg: string;
  gc: string;
  name: string;
  cat: string;
  phase: string;
  status: 'ok' | 'sandbox' | 'attention';
  cred: string;
  scopes: string[];
  verified: string;
}

const STATUS: Record<Conn['status'], { label: string; c: string; bg: string }> = {
  ok: { label: 'Connected', c: 'var(--grn)', bg: 'rgba(19,122,91,.1)' },
  sandbox: { label: 'Sandbox', c: 'var(--amb)', bg: 'rgba(180,83,9,.12)' },
  attention: { label: 'Action needed', c: 'var(--red)', bg: 'rgba(179,38,30,.09)' }
};

interface ConfigIssue { key: string; severity: 'error' | 'warn' | 'ok'; problem: string; fix: string; }
interface CredExpiry { id: string; label: string; daysLeft: number | null; severity: 'error' | 'warn' | 'ok'; note: string; }
interface ConfigHealth { issues: ConfigIssue[]; expiry: CredExpiry[]; errors: number; warnings: number; }

export default function Connections() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [cfg, setCfg] = useState<ConfigHealth | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await api.get<{ connections: Conn[] }>('/api/connections');
    setConns(r.connections);
    // Admin-only; non-admins simply don't see the panel.
    setCfg(await api.get<ConfigHealth>('/api/config-health').catch(() => null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const test = async (id: string) => {
    setTestMsg((m) => ({ ...m, [id]: 'testing…' }));
    const r = await api
      .post<{ ok: boolean; ms: number; detail?: string }>(`/api/connections/${id}/test`)
      .catch(() => ({ ok: false, ms: 0, detail: 'unreachable' }));
    setTestMsg((m) => ({
      ...m,
      [id]: r.ok ? `✓ ${r.detail ?? 'OK'} · ${r.ms}ms` : `✕ ${r.detail ?? 'unreachable'}`
    }));
    window.setTimeout(() => setTestMsg((m) => ({ ...m, [id]: '' })), 8000);
  };

  const sevColor = (s: string) => (s === 'error' ? 'var(--red)' : s === 'warn' ? 'var(--amb)' : 'var(--grn)');

  return (
    <div>
      {/* Config & credential health — catches the failure modes that produce
          confusing outages (empty vars, corrupted secrets, expiring tokens). */}
      {cfg && (cfg.errors > 0 || cfg.warnings > 0) && (
        <div
          className="card"
          style={{ padding: '14px 17px', marginBottom: 12, borderLeft: `3px solid ${cfg.errors > 0 ? 'var(--red)' : 'var(--amb)'}` }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: cfg.errors > 0 ? 'var(--red)' : 'var(--amb)' }}>
            {cfg.errors > 0 ? `⚠ ${cfg.errors} configuration error${cfg.errors > 1 ? 's' : ''}` : `${cfg.warnings} configuration warning${cfg.warnings > 1 ? 's' : ''}`}
            {cfg.errors > 0 && cfg.warnings > 0 ? ` · ${cfg.warnings} warning${cfg.warnings > 1 ? 's' : ''}` : ''}
          </div>
          {cfg.issues.map((i) => (
            <div key={i.key} style={{ marginTop: 9 }}>
              <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: sevColor(i.severity) }}>{i.key}</div>
              <div style={{ fontSize: 11.5, color: 'var(--tx2)', lineHeight: 1.5, marginTop: 2 }}>{i.problem}</div>
              <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.5, marginTop: 2 }}>Fix: {i.fix}</div>
            </div>
          ))}
          {cfg.expiry.filter((e) => e.severity !== 'ok').map((e) => (
            <div key={e.id} style={{ marginTop: 9 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: sevColor(e.severity) }}>
                {e.label}{e.daysLeft !== null ? ` — ${e.daysLeft <= 0 ? 'EXPIRED' : `${e.daysLeft} day(s) left`}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.5, marginTop: 2 }}>{e.note}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12 }}>
        {conns.map((c) => {
          const s = STATUS[c.status];
          return (
            <div key={c.id} className="card" style={{ padding: '15px 17px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span
                  className="mono"
                  style={{ width: 33, height: 33, borderRadius: 8, background: c.gbg, color: c.gc, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >
                  {c.glyph}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{c.cat} · {c.phase}</div>
                </div>
                <span className="pill" style={{ color: s.c, background: s.bg }}>{s.label}</span>
              </div>
              <div className="codebox" style={{ marginTop: 11 }}>{c.cred}</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 9 }}>
                {c.scopes.map((sc) => (
                  <span key={sc} className="mono" style={{ fontSize: 9.5, background: 'var(--bg3)', border: '1px solid var(--line4)', borderRadius: 99, padding: '2px 8px', color: 'var(--tx2)' }}>
                    {sc}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 11 }}>
                <span style={{ fontSize: 10.5, color: c.status === 'attention' ? 'var(--red)' : 'var(--tx3)' }}>{c.verified}</span>
                <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11, marginLeft: 'auto', flexShrink: 0 }} onClick={() => test(c.id)}>
                  Test
                </button>
              </div>
              {testMsg[c.id] && (
                <div
                  className="mono"
                  style={{ fontSize: 10, marginTop: 7, color: testMsg[c.id].startsWith('✕') ? 'var(--red)' : 'var(--grn)', wordBreak: 'break-all', lineHeight: 1.5 }}
                >
                  {testMsg[c.id]}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.6, maxWidth: 760, marginTop: 16 }}>
        Status is computed live from the deployment's environment variables — “Action needed” rows name the exact vars to set,
        and Test makes one authenticated call against the real provider. Social platforms are non-blocking: a failed platform is
        flagged on the run while the others still publish. Set global defaults in Settings → adapters, or pick channels per run at
        the distribution review gate.
      </p>
    </div>
  );
}
