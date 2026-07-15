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

export default function Connections() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await api.get<{ connections: Conn[] }>('/api/connections');
    setConns(r.connections);
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

  return (
    <div>
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
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, alignItems: 'center' }}>
                  {testMsg[c.id] && (
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: testMsg[c.id].startsWith('✕') ? 'var(--red)' : 'var(--grn)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={testMsg[c.id]}
                    >
                      {testMsg[c.id]}
                    </span>
                  )}
                  <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }} onClick={() => test(c.id)}>
                    Test
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.6, maxWidth: 760, marginTop: 16 }}>
        Status is computed live from the deployment's environment variables — “Action needed” rows name the exact vars to set,
        and Test makes one authenticated call against the real provider. Social platforms are non-blocking: a failed platform is
        flagged on the run while the others still publish. Channels can be disabled per-run type in Settings → adapters.
      </p>
    </div>
  );
}
