import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Run } from '../lib/types';
import { MicroLabel } from '../components/ui';
import PdfSheet from '../components/PdfSheet';
import AuditModal from '../components/AuditModal';

// Lead magnets page (DESIGN_SPEC §8.5).

interface Magnet {
  id: string;
  name: string;
  run: string;
  runId: string | null;
  client: string;
  painPoint: string;
  runStatus: string | null;
  url: string | null;
  pdfUrl: string;
  leads: number;
  t: number;
}

const FILTERS = ['All', 'Live', 'Pending', 'Failed'];

export default function Magnets() {
  const { runs } = useApp();
  const [magnets, setMagnets] = useState<Magnet[]>([]);
  const [filter, setFilter] = useState('All');
  const [openId, setOpenId] = useState<string | null>(null);
  const [logRun, setLogRun] = useState<Run | null>(null);

  useEffect(() => {
    api.get<{ magnets: Magnet[] }>('/api/magnets').then((r) => setMagnets(r.magnets));
  }, []);

  const state = (m: Magnet): 'Live' | 'Pending' | 'Failed' =>
    m.url ? 'Live' : m.runStatus === 'failed' ? 'Failed' : 'Pending';

  const filtered = magnets.filter((m) => filter === 'All' || state(m) === filter);
  const nLive = magnets.filter((m) => state(m) === 'Live').length;
  const totalLeads = magnets.reduce((s, m) => s + m.leads, 0);

  const stats: Array<[string, number, string, string]> = [
    ['Lead magnets', magnets.length, 'var(--amb)', 'PDF resources generated'],
    ['Live on site', nLive, 'var(--grn)', 'downloadable at elementaccounting.ca'],
    ['Leads captured', totalLeads, 'var(--vio)', 'name + email → ActiveCampaign']
  ];

  const pillFor = (s: 'Live' | 'Pending' | 'Failed') =>
    s === 'Live'
      ? { label: 'Live', c: 'var(--grn)', bg: 'rgba(19,122,91,.11)' }
      : s === 'Failed'
        ? { label: 'Deploy failed', c: 'var(--red)', bg: 'rgba(179,38,30,.09)' }
        : { label: 'Pending deploy', c: 'var(--amb)', bg: 'rgba(180,83,9,.11)' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {stats.map(([label, v, c, sub]) => (
          <div key={label} className="card" style={{ padding: '14px 17px' }}>
            <MicroLabel>{label}</MicroLabel>
            <div className="disp" style={{ fontSize: 25, fontWeight: 700, color: c, marginTop: 4 }}>{v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
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
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tx3)' }}>
          delivered as a PDF on sign-up · name + email → ActiveCampaign
        </span>
      </div>

      {filtered.length === 0 && <div style={{ padding: '40px 0', fontSize: 12, color: 'var(--tx3)' }}>No lead magnets match.</div>}

      <div style={{ marginTop: 12 }}>
        {filtered.map((m) => {
          const st = state(m);
          const p = pillFor(st);
          const run = runs.find((r) => r.id === m.runId) ?? null;
          return (
            <div key={m.id} className="card" style={{ padding: '14px 17px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 9, border: '1px solid var(--line6)', borderRadius: 4, padding: '2px 6px', color: 'var(--tx2)' }}>PDF</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name.split(' — ')[0]}</span>
                <span className="pill" style={{ color: p.c, background: p.bg }}>{p.label}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{m.run} · {m.client}</span>
              </div>
              {m.painPoint && (
                <div style={{ fontSize: 11.5, color: 'var(--tx2)', borderLeft: '2px solid var(--line4)', paddingLeft: 10, marginTop: 9, lineHeight: 1.55 }}>
                  {m.painPoint}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--vio)' }}>{m.leads} lead{m.leads === 1 ? '' : 's'} captured</span>
                <span className="mono" style={{ fontSize: 10.5, color: m.url ? 'var(--grn)' : 'var(--tx4)' }}>
                  {m.url ?? '— URL assigned at deploy'}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
                  <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }} onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                    {openId === m.id ? 'Hide preview' : 'Preview PDF'}
                  </button>
                  {run && (
                    <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }} onClick={() => setLogRun(run)}>
                      Run log
                    </button>
                  )}
                </div>
              </div>
              {openId === m.id && (
                <div style={{ marginTop: 12 }}>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)', maxWidth: 500, margin: '0 auto 8px' }}>
                    lead-magnet.pdf · by ChatGPT Business API · 38 KB
                  </div>
                  <PdfSheet magnetName={m.name} footer="delivered as a downloadable PDF on sign-up" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {logRun && <AuditModal run={logRun} onClose={() => setLogRun(null)} />}
    </div>
  );
}
