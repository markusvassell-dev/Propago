import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { MicroLabel } from '../components/ui';
import { fmtAgo } from '../lib/format';

// Uniqueness registry page (DESIGN_SPEC §8.6).

interface Entry {
  id: string;
  type: string;
  title: string;
  hash: string;
  sim: number | null;
  lev: number | null;
  status: 'unique' | 'regenerated' | 'duplicate-blocked';
  run: string;
  t: number;
}
interface Stats { total: number; unique: number; regenerated: number; blocked: number; }

const TYPE_COLOR: Record<string, string> = {
  blog: 'var(--grn)',
  magnet: 'var(--amb)',
  painpoint: 'var(--cyn)',
  linkedin: 'var(--vio)',
  facebook: 'var(--vio)',
  instagram: 'var(--vio)'
};
const STATUS_PILL: Record<Entry['status'], { label: string; c: string; bg: string }> = {
  unique: { label: 'unique', c: 'var(--grn)', bg: 'rgba(19,122,91,.11)' },
  regenerated: { label: 'regenerated', c: 'var(--amb)', bg: 'rgba(180,83,9,.12)' },
  'duplicate-blocked': { label: 'duplicate — blocked', c: 'var(--red)', bg: 'rgba(179,38,30,.09)' }
};
const FILTERS = [
  { k: 'all', label: 'All' },
  { k: 'blog', label: 'Blog' },
  { k: 'social', label: 'Social' },
  { k: 'magnet', label: 'Magnets' },
  { k: 'painpoint', label: 'Pain points' },
  { k: 'blocked', label: 'Blocked' }
];
const GRID = '92px minmax(220px,1fr) 156px 156px 128px 74px';

export default function Registry() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, unique: 0, regenerated: 0, blocked: 0 });
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.get<{ entries: Entry[]; stats: Stats }>('/api/registry').then((r) => {
      setEntries(r.entries);
      setStats(r.stats);
    });
  }, []);

  const filtered = entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'blocked') return e.status === 'duplicate-blocked';
    if (filter === 'social') return ['linkedin', 'facebook', 'instagram'].includes(e.type);
    return e.type === filter;
  });

  const cards: Array<[string, number, string]> = [
    ['Registered assets', stats.total, 'var(--tx)'],
    ['Unique · saved', stats.unique, 'var(--grn)'],
    ['Regenerated', stats.regenerated, 'var(--amb)'],
    ['Duplicates blocked', stats.blocked, 'var(--red)']
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {cards.map(([label, v, c]) => (
          <div key={label} className="card" style={{ padding: '14px 17px' }}>
            <MicroLabel>{label}</MicroLabel>
            <div className="disp" style={{ fontSize: 25, fontWeight: 700, color: c, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>enforce: SHA-256 + TF-IDF cosine ≥ 0.82</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {FILTERS.map((f) => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              className="pill"
              style={{
                cursor: 'pointer',
                border: '1px solid var(--line4)',
                background: filter === f.k ? 'var(--tx)' : 'var(--bg3)',
                color: filter === f.k ? 'var(--bg2)' : 'var(--tx2)'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, overflowX: 'auto' }}>
        <div style={{ minWidth: 840 }}>
          <div className="microlabel" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--line2)' }}>
            <span>Type</span><span>Asset</span><span>SHA-256</span><span>Similarity</span><span>Status</span><span>Run</span>
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: '26px 18px', fontSize: 12, color: 'var(--tx3)' }}>No assets of this type yet.</div>
          )}
          {filtered.map((e) => {
            const sp = STATUS_PILL[e.status];
            const isPP = e.type === 'painpoint';
            const simVal = isPP ? e.lev : e.sim;
            const simHot = simVal != null && (isPP ? simVal >= 0.7 : simVal >= 0.82);
            return (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--line2)', alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 10.5, color: TYPE_COLOR[e.type] ?? 'var(--tx2)' }}>{e.type}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--tx4)', marginTop: 2 }}>{fmtAgo(e.t)}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{e.hash}</span>
                <span className="mono" style={{ fontSize: 10, color: simHot ? 'var(--red)' : 'var(--tx2)' }}>
                  {simVal == null ? '—' : isPP ? `Levenshtein ${simVal}` : `TF-IDF cosine ${simVal}`}
                </span>
                <span className="pill" style={{ color: sp.c, background: sp.bg }}>{sp.label}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{e.run}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--tx3)', lineHeight: 1.55, maxWidth: 660 }}>
        Every asset is fingerprinted before finalisation. Exact matches (SHA-256) and fuzzy near-duplicates (TF-IDF cosine ≥ 0.82) are rejected and regenerated automatically — no repeat content is ever permitted.
      </div>
    </div>
  );
}
