import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';

// Connections page (DESIGN_SPEC §8.7): the 9 provider cards, Test ping,
// Instagram reconnect flow.

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
  const { showToast } = useApp();
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
    setTestMsg((m) => ({ ...m, [id]: 'pinging…' }));
    const r = await api.post<{ ok: boolean; ms: number }>(`/api/connections/${id}/test`).catch(() => ({ ok: false, ms: 0 }));
    setTestMsg((m) => ({ ...m, [id]: r.ok ? `✓ 200 OK · ${r.ms}ms` : '✕ unreachable' }));
    window.setTimeout(() => setTestMsg((m) => ({ ...m, [id]: '' })), 2700);
  };

  const reconnect = async (id: string) => {
    await api.post(`/api/connections/${id}/reconnect`);
    showToast('Instagram token refreshed — future runs post 3/3');
    await load();
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
                  {testMsg[c.id] && <span className="mono" style={{ fontSize: 10, color: 'var(--grn)' }}>{testMsg[c.id]}</span>}
                  {c.id === 'ig' && c.status === 'attention' && (
                    <button className="btn btn-redsolid" style={{ padding: '5px 11px', fontSize: 11 }} onClick={() => reconnect(c.id)}>
                      Reconnect
                    </button>
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
        All tokens are AES-256-GCM encrypted at rest with a master key from the environment — never stored in plaintext. Instagram's expired token demonstrates the non-blocking failure path: social publishing continues on LinkedIn + Facebook and flags IG for reconnection.
      </p>
    </div>
  );
}
