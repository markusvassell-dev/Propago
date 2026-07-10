import { useState } from 'react';
import { Run } from '../lib/types';
import PdfSheet from './PdfSheet';
import { KeywordChip } from './ui';
import { cap } from '../lib/format';

// Content preview modal (DESIGN_SPEC §9.2): a 1:1 mock of the Element
// Accounting website theme (Arial, greige #E1DBD6, green #597363 headings,
// copper #BC7C54 buttons, dark-green #3C4C3C footer band) + the magnet tab.
// This is also the visual contract for services/blogHtml.ts (README rule 12).

function parseBody(body: string): { intro: string[]; sections: Array<{ h: string; paras: string[] }> } {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const intro: string[] = [];
  const sections: Array<{ h: string; paras: string[] }> = [];
  let cur: { h: string; paras: string[] } | null = null;
  for (const b of blocks) {
    const h = b.match(/^##\s+(.+)$/);
    if (h) {
      cur = { h: h[1].replace(/:$/, ''), paras: [] };
      sections.push(cur);
    } else if (b.startsWith('#')) {
      continue;
    } else if (cur) {
      cur.paras.push(b.replace(/^[-*]\s+/gm, ''));
    } else {
      intro.push(b);
    }
  }
  return { intro, sections };
}

export default function PreviewModal({ run, onClose }: { run: Run; onClose: () => void }) {
  const [tab, setTab] = useState<'post' | 'magnet'>('post');
  const d = run.draft;
  if (!d) return null;
  const live = !!run.artifacts.blogUrl;
  const { intro, sections } = parseBody(d.body ?? d.meta);
  const category = cap(run.keywords[0] ?? 'Advisory');
  const minutes = Math.max(1, Math.round((d.words ?? 250) / 250));
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const A = { fontFamily: 'Arial, sans-serif' } as const;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,11,9,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 880, maxHeight: '88vh', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)', boxShadow: '0 24px 60px rgba(15,13,10,.4)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 20px', borderBottom: '1px solid var(--line2)' }}>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{run.wf} · {run.karbon}</span>
          <span
            className="pill"
            style={live ? { color: 'var(--grn)', background: 'rgba(19,122,91,.11)' } : { color: 'var(--vio)', background: 'rgba(91,79,194,.11)' }}
          >
            {live ? 'Published' : 'Draft — not yet live'}
          </span>
          {live && (
            <a
              className="mono"
              href={`https://${run.artifacts.blogUrl}`}
              target="_blank"
              rel="noreferrer"
              style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--grn)', textDecoration: 'none' }}
            >
              ↗ {run.artifacts.blogUrl}
            </a>
          )}
          <button
            onClick={onClose}
            style={{ marginLeft: live ? 10 : 'auto', width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line5)', background: 'transparent', color: 'var(--tx2)', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '0 20px', borderBottom: '1px solid var(--line2)' }}>
          {(['post', 'magnet'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 13px',
                fontSize: 12.5,
                fontWeight: tab === t ? 600 : 500,
                color: tab === t ? 'var(--tx)' : 'var(--tx3)',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${tab === t ? 'var(--grn)' : 'transparent'}`,
                marginBottom: -1,
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              {t === 'post' ? 'Full blog post' : 'Lead magnet PDF'}
            </button>
          ))}
        </div>

        <div style={{ overflow: 'auto', padding: 20 }}>
          {tab === 'post' ? (
            <>
              {/* ── Element Accounting theme sheet ── */}
              <div style={{ width: 700, maxWidth: '100%', margin: '0 auto', border: '1px solid var(--line5)', boxShadow: '0 8px 26px rgba(20,18,12,.12)', background: '#fff' }}>
                {/* header bar */}
                <div style={{ background: '#ffffff', display: 'flex', alignItems: 'center', gap: 18, padding: '12px 22px' }}>
                  <img src="/design-assets/element-logo.png" alt="Element Accounting" style={{ height: 30 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                  <nav style={{ ...A, fontSize: 11, color: '#597363', display: 'flex', gap: 13, marginLeft: 'auto', alignItems: 'center' }}>
                    <span>What We Do</span>
                    <span>Packages</span>
                    <span>About</span>
                    <span style={{ fontWeight: 700 }}>Blog</span>
                    <span>Resources</span>
                    <span style={{ ...A, background: '#BC7C54', color: '#fff', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', padding: '7px 12px' }}>
                      LET'S WORK TOGETHER
                    </span>
                  </nav>
                </div>
                {/* hero */}
                <div style={{ background: 'linear-gradient(158deg, #79836F 0%, #5A6350 55%, #454E3D 100%)', padding: '54px 48px 40px', position: 'relative' }}>
                  <div className="mono" style={{ position: 'absolute', top: 8, right: 10, fontSize: 7.5, letterSpacing: '.08em', color: 'rgba(255,255,255,.55)' }}>
                    FEATURED IMAGE — SET FROM MEDIA LIBRARY AT DEPLOY
                  </div>
                  <div style={{ ...A, fontSize: 31, fontWeight: 700, color: '#fff', lineHeight: 1.25, textShadow: '0 2px 10px rgba(0,0,0,.35)' }}>
                    {d.title}
                  </div>
                  <div style={{ ...A, fontSize: 11, fontWeight: 700, color: '#fff', marginTop: 12 }}>
                    In {category} • {dateStr} • {minutes} Minutes
                  </div>
                </div>
                {/* body */}
                <div style={{ background: '#E1DBD6', padding: '36px 48px' }}>
                  {intro.map((p, i) => (
                    <p key={i} style={{ ...A, fontSize: 13, lineHeight: 1.85, color: '#3F3A3B', textAlign: 'justify', margin: '0 0 14px' }}>{p}</p>
                  ))}
                  {sections.map((s, i) => (
                    <div key={i}>
                      <h2 style={{ ...A, fontSize: 21, fontWeight: 700, color: '#597363', margin: '26px 0 10px' }}>{s.h}:</h2>
                      {s.paras.map((p, j) => (
                        <div key={j} style={{ display: 'flex', gap: 10, margin: '0 0 12px' }}>
                          <span style={{ ...A, color: '#3F3A3B', fontSize: 13, lineHeight: 1.85 }}>•</span>
                          <p style={{ ...A, fontSize: 13, lineHeight: 1.85, color: '#3F3A3B', textAlign: 'justify', margin: 0 }}>{p}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {/* footer CTA band */}
                <div style={{ background: '#3C4C3C', padding: '30px 48px' }}>
                  <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
                    <div style={{ maxWidth: 240 }}>
                      <div style={{ ...A, fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.35 }}>
                        We'd love to start a conversation with you!
                      </div>
                      <div style={{ ...A, display: 'inline-block', background: '#BC7C54', color: '#fff', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', padding: '8px 14px', marginTop: 14 }}>
                        CONTACT US
                      </div>
                    </div>
                    {[
                      ['Quick Links', ['What We Do', 'Packages', 'About', 'Blog']],
                      ['Our Services', ['Bookkeeping', 'Payroll', 'Year-End & Tax', 'Advisory']],
                      ['Get In Touch', ['info@elementaccounting.ca', 'elementaccounting.ca']]
                    ].map(([h, links]) => (
                      <div key={h as string}>
                        <div style={{ ...A, fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{h}</div>
                        {(links as string[]).map((l) => (
                          <div key={l} style={{ ...A, fontSize: 10.5, color: 'rgba(255,255,255,.72)', marginBottom: 5 }}>{l}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div style={{ ...A, fontSize: 10, color: 'rgba(255,255,255,.45)', marginTop: 20 }}>© 2026 Element Accounting</div>
                </div>
              </div>

              <div style={{ maxWidth: 700, margin: '16px auto 0' }}>
                <div className="microlabel">SEO meta description</div>
                <div style={{ fontSize: 12.5, color: 'var(--tx1)', borderLeft: '2px solid var(--line4)', paddingLeft: 10, marginTop: 6, lineHeight: 1.6 }}>
                  “{d.meta}”
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                  {run.keywords.map((k) => (
                    <KeywordChip key={k}>{k}</KeywordChip>
                  ))}
                  <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>
                    {(d.words ?? 0).toLocaleString('en-US')} words · theme preview — deploys to elementaccounting.ca/blog
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 500, margin: '0 auto 12px' }}>
                <span className="mono" style={{ fontSize: 9, border: '1px solid var(--line6)', borderRadius: 4, padding: '2px 6px', color: 'var(--tx2)' }}>PDF</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx3)' }}>lead-magnet.pdf · delivered on sign-up</span>
                <span className="mono" style={{ fontSize: 10.5, marginLeft: 'auto', color: run.artifacts.magnetUrl ? 'var(--grn)' : 'var(--tx4)' }}>
                  {run.artifacts.magnetUrl ?? 'URL assigned at deploy'}
                </span>
              </div>
              <PdfSheet
                magnetName={d.magnet || 'Financial Health Checklist — 12-point PDF'}
                footer="Delivered as a downloadable PDF the moment someone submits the sign-up form — the name and email flow straight to ActiveCampaign."
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
