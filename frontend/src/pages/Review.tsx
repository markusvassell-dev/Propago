import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Run, AdsPayload, EmailPayload, SocialPayload } from '../lib/types';
import { MicroLabel, KeywordChip, ScoreBar } from '../components/ui';
import PdfSheet from '../components/PdfSheet';
import PreviewModal from '../components/PreviewModal';
import { fmtAgo, slug3Of } from '../lib/format';

// Review queue (DESIGN_SPEC §7) — both human gates in one page.
//   Gate 1 (review):     Blog tab, approve / edit / revision / remake / reject.
//   Gate 2 (distreview): Meta Ads / Email / Social editable; Publish All.

type Tab = 'blog' | 'ads' | 'email' | 'social';

const emptyAds: AdsPayload = { headline: '', primary: '', link: '' };
const emptyEmail: EmailPayload = { subject: '', body: '' };
const emptySocial: SocialPayload = { linkedin: '', facebook: '', instagram: '' };

export default function Review() {
  const { user, canApprove } = useAuth();
  const { showToast, refreshRuns } = useApp();
  const [items, setItems] = useState<Run[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('blog');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editT, setEditT] = useState('');
  const [editM, setEditM] = useState('');
  const [revising, setRevising] = useState(false);
  const [revNote, setRevNote] = useState('');
  const [ads, setAds] = useState<AdsPayload>(emptyAds);
  const [email, setEmail] = useState<EmailPayload>(emptyEmail);
  const [social, setSocial] = useState<SocialPayload>(emptySocial);
  // Per-run channel picks at the distribution gate (default all on).
  const [chan, setChan] = useState<{ ads: boolean; email: boolean; social: boolean }>({ ads: true, email: true, social: true });
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: Run[] }>('/api/review-queue');
      setItems(r.items);
    } catch {
      /* poll retries */
    }
  }, []);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 2000);
    return () => window.clearInterval(iv);
  }, [load]);

  const sel = useMemo(() => items.find((i) => i.id === selId) ?? items[0] ?? null, [items, selId]);
  const isDist = sel?.status === 'distreview';

  // Presence heartbeat for the open item (peer-viewing banner).
  useEffect(() => {
    if (!sel) return;
    api.post(`/api/runs/${sel.id}/viewing`).catch(() => undefined);
    const iv = window.setInterval(() => api.post(`/api/runs/${sel.id}/viewing`).catch(() => undefined), 10_000);
    return () => window.clearInterval(iv);
  }, [sel?.id]);

  // Local editable copies of the distribution payloads.
  useEffect(() => {
    if (!sel || loadedFor.current === sel.id + sel.status) return;
    loadedFor.current = sel.id + sel.status;
    setAds(sel.dist?.ads ?? emptyAds);
    setEmail(sel.dist?.email ?? emptyEmail);
    setSocial(sel.dist?.social ?? emptySocial);
    setTab(sel.status === 'distreview' ? 'ads' : 'blog');
    setChan({ ads: true, email: true, social: true });
    setEditing(false);
    setRevising(false);
    setPdfOpen(false);
  }, [sel?.id, sel?.status]);

  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const edited = {
    ads: !!sel?.distOrig?.ads && !eq(ads, sel.distOrig.ads),
    email: !!sel?.distOrig?.email && !eq(email, sel.distOrig.email),
    social: !!sel?.distOrig?.social && !eq(social, sel.distOrig.social)
  };

  const conflictToast = (err: unknown, template: (wf: string, who: string) => string) => {
    if (err instanceof ApiError && err.status === 409) {
      const wf = (err.data.runId as string) || sel?.wf || '';
      const who = (err.data.who as string) || 'another user';
      showToast(template(wf, who));
      load();
      return true;
    }
    return false;
  };

  const approve = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t approve — admin or reviewer required');
    try {
      await api.post(`/api/runs/${sel.id}/approve`);
      showToast(`${sel.wf} approved by ${user!.handle} → deploy queued`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already approved by ${who} — nothing overwritten`);
    }
  };

  const sendRevision = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t request revisions — admin or reviewer required');
    try {
      await api.post(`/api/runs/${sel.id}/request-revision`, { note: revNote });
      setRevNote('');
      setRevising(false);
      showToast(`${sel.wf} → revision loop · regenerating draft`);
      await load();
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already approved by ${who} — revision not sent`);
    }
  };

  const remake = async () => {
    if (!sel) return;
    try {
      await api.post(`/api/runs/${sel.id}/remake`);
      showToast(`${sel.wf} → draft discarded · regenerating from scratch`);
      await load();
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — remake not sent`);
    }
  };

  const reject = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t reject — admin or reviewer required');
    try {
      await api.post(`/api/runs/${sel.id}/reject`);
      showToast(`${sel.wf} rejected by ${user!.handle} — run discarded`);
      await load();
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — nothing overwritten`);
    }
  };

  const saveEdits = async () => {
    if (!sel) return;
    try {
      await api.patch(`/api/runs/${sel.id}/draft`, { title: editT, meta: editM });
      setEditing(false);
      showToast('Draft edited — title + meta description updated');
      await load();
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — nothing overwritten`);
    }
  };

  const resetChannel = async (ch: 'ads' | 'email' | 'social') => {
    if (!sel?.distOrig) return;
    const names = { ads: 'Meta Ads', email: 'Email', social: 'Social' } as const;
    if (ch === 'ads') setAds(sel.distOrig.ads ?? emptyAds);
    if (ch === 'email') setEmail(sel.distOrig.email ?? emptyEmail);
    if (ch === 'social') setSocial(sel.distOrig.social ?? emptySocial);
    const path = { ads: 'meta_ads', email: 'ac_email', social: 'social' }[ch];
    const payload = ch === 'ads' ? sel.distOrig.ads : ch === 'email' ? sel.distOrig.email : sel.distOrig.social;
    await api.patch(`/api/runs/${sel.id}/distribution/${path}`, payload).catch(() => undefined);
    showToast(`${names[ch]} payload reset to generated version`);
  };

  const publishAll = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t publish — admin or reviewer required');
    if (!chan.ads && !chan.email && !chan.social) return showToast('Select at least one channel to publish');
    try {
      // Only save edits for channels being published.
      if (chan.ads) await api.patch(`/api/runs/${sel.id}/distribution/meta_ads`, ads);
      if (chan.email) await api.patch(`/api/runs/${sel.id}/distribution/ac_email`, email);
      if (chan.social) await api.patch(`/api/runs/${sel.id}/distribution/social`, social);
      await api.post(`/api/runs/${sel.id}/publish-all`, { channels: chan });
      const on = (['ads', 'email', 'social'] as const).filter((k) => chan[k]).map((k) => names[k]).join(' · ');
      showToast(`${sel.wf} → publishing ${on || 'nothing'}`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already published by ${who} — nothing overwritten`);
    }
  };

  // ---- §7.1 empty state ----
  if (!sel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 90, textAlign: 'center' }}>
        <MicroLabel>queue clear</MicroLabel>
        <div className="disp" style={{ fontSize: 19, fontWeight: 600, marginTop: 8 }}>0 drafts awaiting review</div>
        <p style={{ fontSize: 12, color: 'var(--tx2)', maxWidth: 440, lineHeight: 1.65, marginTop: 8 }}>
          Runs pause here twice — once for the blog draft after SEO scoring, and again for ad, email and social payloads before anything publishes.
        </p>
      </div>
    );
  }

  const seo = sel.seo;
  const th = 80;
  const waitSince = sel.stages[isDist ? 7 : 4]?.startedAt ?? sel.updatedAt;
  const peer = (sel.viewers ?? [])[0];
  const counter = (n: number, max: number) => (
    <span className="mono" style={{ fontSize: 10, color: n > max ? 'var(--red)' : 'var(--tx3)' }}>{n}/{max}</span>
  );
  const tabs: Array<{ k: Tab; label: string }> = [
    { k: 'blog', label: 'Blog post' },
    { k: 'ads', label: 'Meta Ads' },
    { k: 'email', label: 'Email' },
    { k: 'social', label: 'Social' }
  ];
  const utmChip = (chip: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <span className="microlabel">utm enforced at publish</span>
      <span className="codebox" style={{ padding: '3px 8px', fontSize: 10 }}>{chip}</span>
    </div>
  );
  const editorDim = !canApprove ? 'btn-editor-dim' : '';

  return (
    <div>
      {/* §7.2 card strip */}
      <MicroLabel>Awaiting review · {items.length}</MicroLabel>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '10px 2px 4px' }}>
        {items.map((i) => {
          const isSel = i.id === sel.id;
          const g = i.status === 'distreview';
          return (
            <button
              key={i.id}
              onClick={() => setSelId(i.id)}
              className="card"
              style={{
                width: 242,
                flexShrink: 0,
                padding: '11px 13px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
                borderColor: isSel ? 'var(--grn)' : 'var(--line)',
                boxShadow: isSel ? '0 2px 8px rgba(19,122,91,.12)' : 'none'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--grn)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = isSel ? 'var(--grn)' : 'var(--line)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{i.wf}</span>
                <span
                  className="pill"
                  style={g ? { color: 'var(--cyn)', background: 'rgba(14,116,144,.1)' } : { color: 'var(--vio)', background: 'rgba(91,79,194,.1)' }}
                >
                  {g ? 'distribution' : 'content'}
                </span>
                {i.seo && (
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: i.seo.total >= th ? 'var(--grn)' : 'var(--amb)' }}>
                    {i.seo.total}/100
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 7, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {i.draft?.title ?? i.topic}
              </div>
              <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 5 }}>
                {i.client} · waiting {fmtAgo(i.stages[i.status === 'distreview' ? 7 : 4]?.startedAt ?? i.updatedAt).replace(' ago', '')}
              </div>
            </button>
          );
        })}
      </div>

      {/* §7.3 main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 14, marginTop: 10 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          {!isDist && peer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(217,119,6,.1)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
              <span className="nf-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ambH)', flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: 'var(--amb)' }}>
                {peer} is viewing this draft right now — approvals are first-come, and you'll be notified if it moves.
              </span>
            </div>
          )}

          <nav style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line2)', marginBottom: 16 }}>
            {tabs.map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                style={{ position: 'relative', padding: '8px 13px', fontSize: 12.5, fontWeight: tab === t.k ? 600 : 500, color: tab === t.k ? 'var(--tx)' : 'var(--tx3)', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.k ? 'var(--grn)' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {t.label}
                {t.k !== 'blog' && edited[t.k] && (
                  <span style={{ position: 'absolute', top: 7, right: 4, width: 5, height: 5, borderRadius: '50%', background: 'var(--ambH)' }} />
                )}
              </button>
            ))}
          </nav>

          {/* ── Blog post tab ── */}
          {tab === 'blog' && sel.draft && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="pill" style={isDist ? { color: 'var(--grn)', background: 'rgba(19,122,91,.12)' } : { color: 'var(--vio)', background: 'rgba(91,79,194,.14)' }}>
                  {isDist ? 'approved' : 'draft'}
                </span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx3)' }}>
                  {(sel.draft.words ?? 0).toLocaleString('en-US')} words · {sel.revisions === 0 ? 'first draft' : `revision ${sel.revisions}`}
                </span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--tx4)' }}>{sel.wf}</span>
              </div>

              {!editing ? (
                <>
                  <div className="disp" style={{ fontSize: 21, fontWeight: 600, marginTop: 12, lineHeight: 1.35 }}>{sel.draft.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--tx1)', borderLeft: '2px solid var(--line4)', paddingLeft: 10, marginTop: 10, lineHeight: 1.6 }}>
                    {sel.draft.meta}
                  </div>
                  <button className="btn btn-ink" style={{ marginTop: 13 }} onClick={() => setPreview(true)}>
                    Preview whole blog + lead magnet →
                  </button>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 13 }}>
                    {sel.keywords.map((k) => (
                      <KeywordChip key={k}>{k}</KeywordChip>
                    ))}
                  </div>
                  <div style={{ height: 1, background: 'var(--line2)', margin: '15px 0' }} />
                  {(sel.draft.body ?? '').split(/\n{2,}/).filter((b) => !b.startsWith('#') && !b.startsWith('-')).slice(0, 2).map((p, i) => (
                    <p key={i} style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--tx1)', margin: '0 0 11px' }}>{p}</p>
                  ))}
                  <MicroLabel style={{ marginTop: 14 }}>Section outline</MicroLabel>
                  <div style={{ marginTop: 6 }}>
                    {(sel.draft.body ?? '').split('\n').filter((l) => l.startsWith('## ')).map((l, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px dashed var(--line2)', alignItems: 'baseline' }}>
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--grn)', fontWeight: 600 }}>H2</span>
                        <span style={{ fontSize: 12.5 }}>{l.replace(/^## /, '').replace(/:$/, '')}</span>
                      </div>
                    ))}
                  </div>
                  {/* lead magnet row */}
                  <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: '11px 13px', marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mono" style={{ fontSize: 9, border: '1px solid var(--line6)', borderRadius: 4, padding: '2px 6px', color: 'var(--tx2)' }}>PDF</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{sel.draft.magnet}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--tx3)' }}>Lead magnet · generated by ChatGPT Business API · deploys with the post</div>
                      </div>
                      <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 11.5 }} onClick={() => setPdfOpen((v) => !v)}>
                        {pdfOpen ? 'Hide preview' : 'Preview PDF'}
                      </button>
                    </div>
                    {pdfOpen && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>lead-magnet.pdf · by ChatGPT Business API · 38 KB</span>
                          <span className="mono" style={{ fontSize: 10, marginLeft: 'auto', color: sel.artifacts.magnetUrl ? 'var(--grn)' : 'var(--tx4)' }}>
                            {sel.artifacts.magnetUrl ?? 'URL assigned at deploy'}
                          </span>
                        </div>
                        <PdfSheet magnetName={sel.draft.magnet} />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <MicroLabel>Title</MicroLabel>
                  <input className="nf-input" style={{ marginTop: 5 }} value={editT} onChange={(e) => setEditT(e.target.value)} />
                  <MicroLabel style={{ marginTop: 12 }}>Meta description</MicroLabel>
                  <textarea className="nf-input" rows={3} style={{ marginTop: 5 }} value={editM} onChange={(e) => setEditM(e.target.value)} />
                  <div className="mono" style={{ fontSize: 10, marginTop: 4, color: editM.length > 155 ? 'var(--red)' : 'var(--tx3)' }}>{editM.length}/155</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="btn btn-primary" onClick={saveEdits}>Save edits</button>
                    <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Meta Ads tab ── */}
          {tab === 'ads' &&
            (!isDist ? (
              <PendingPlaceholder />
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="pill" style={{ color: 'var(--amb)', background: 'rgba(180,83,9,.12)' }}>meta ads · sandbox</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>LEADGEN objective · queue meta-ads · limiter 10 req/10s</span>
                  {edited.ads && (
                    <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 11 }} onClick={() => resetChannel('ads')}>
                      Reset to generated
                    </button>
                  )}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><MicroLabel>Ad headline</MicroLabel>{counter(ads.headline.length, 40)}</div>
                  <input className="nf-input" style={{ marginTop: 5 }} value={ads.headline} onChange={(e) => setAds({ ...ads, headline: e.target.value })} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}><MicroLabel>Primary text</MicroLabel>{counter(ads.primary.length, 125)}</div>
                  <textarea className="nf-input" rows={4} style={{ marginTop: 5 }} value={ads.primary} onChange={(e) => setAds({ ...ads, primary: e.target.value })} />
                  <MicroLabel style={{ marginTop: 12 }}>Destination link</MicroLabel>
                  <input className="nf-input mono" style={{ marginTop: 5, fontSize: 11 }} value={ads.link} onChange={(e) => setAds({ ...ads, link: e.target.value })} />
                  <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 6, lineHeight: 1.55 }}>
                    ActiveCampaign sign-up form — the ad's lead destination. Counters go red past Meta's recommended limits.
                  </div>
                  <div style={{ marginTop: 12 }}>{utmChip(`?utm_source=meta_ads&utm_medium=paid_social&utm_campaign=${slug3Of(sel.topic)}`)}</div>
                </div>
              </div>
            ))}

          {/* ── Email tab ── */}
          {tab === 'email' &&
            (!isDist ? (
              <PendingPlaceholder />
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="pill" style={{ color: '#265B8F', background: 'rgba(38,91,143,.12)' }}>activecampaign</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>Subscribers (1,842) + ad-leads segment · limiter 5 req/s</span>
                  {edited.email && (
                    <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 11 }} onClick={() => resetChannel('email')}>
                      Reset to generated
                    </button>
                  )}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><MicroLabel>Subject line</MicroLabel>{counter(email.subject.length, 60)}</div>
                  <input className="nf-input" style={{ marginTop: 5 }} value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
                  <MicroLabel style={{ marginTop: 12 }}>Body</MicroLabel>
                  <textarea className="nf-input" rows={11} style={{ marginTop: 5 }} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} />
                  <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 6 }}>
                    The first_name token is an ActiveCampaign merge tag — resolved per contact at send.
                  </div>
                  <div style={{ marginTop: 12 }}>{utmChip(`?utm_source=activecampaign&utm_medium=email&utm_campaign=${slug3Of(sel.topic)}`)}</div>
                </div>
              </div>
            ))}

          {/* ── Social tab ── */}
          {tab === 'social' &&
            (!isDist ? (
              <PendingPlaceholder />
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="pill" style={{ color: 'var(--vio)', background: 'rgba(91,79,194,.1)' }}>organic social</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>3 adapters · independent, non-blocking failures</span>
                  {edited.social && (
                    <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 11 }} onClick={() => resetChannel('social')}>
                      Reset to generated
                    </button>
                  )}
                </div>
                {[
                  { k: 'linkedin' as const, tile: 'LI', bg: '#0A4D77', fg: '#C6E2F2', name: 'LinkedIn', scope: 'company page · w_organization_social', rows: 4, max: 0 },
                  { k: 'facebook' as const, tile: 'FB', bg: '#1B4C8C', fg: '#CBDDF5', name: 'Facebook', scope: 'page token · pages_manage_posts', rows: 3, max: 0 },
                  { k: 'instagram' as const, tile: 'IG', bg: '#7A2E5C', fg: '#F2CFE4', name: 'Instagram', scope: 'instagram_content_publish', rows: 4, max: 2200 }
                ].map((p) => (
                  <div key={p.k} style={{ border: '1px solid var(--line3)', borderRadius: 8, padding: '11px 13px', marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span className="mono" style={{ width: 24, height: 24, borderRadius: 6, background: p.bg, color: p.fg, fontSize: 9.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.tile}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name}</span>
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--tx3)' }}>{p.scope}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: p.max && social[p.k].length > p.max ? 'var(--red)' : 'var(--tx3)' }}>
                        {social[p.k].length}{p.max ? `/${p.max}` : ' chars'}
                      </span>
                    </div>
                    <textarea className="nf-input" rows={p.rows} style={{ marginTop: 8 }} value={social[p.k]} onChange={(e) => setSocial({ ...social, [p.k]: e.target.value })} />
                    {p.k === 'instagram' && (
                      <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 5 }}>Captions can't carry links — the CTA reads "link in bio".</div>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 12 }}>{utmChip(`?utm_source={platform}&utm_medium=organic_social&utm_campaign=${slug3Of(sel.topic)}`)}</div>
              </div>
            ))}
        </div>

        {/* ── right rail ── */}
        <div>
          {!isDist ? (
            <>
              {/* SEO score card (§7.4) */}
              <div className="card" style={{ padding: '14px 17px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <MicroLabel>SEO score</MicroLabel>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--tx3)' }}>threshold {th} · auto off</span>
                </div>
                {seo && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 6 }}>
                      <span className="disp" style={{ fontSize: 40, fontWeight: 700, color: seo.total >= th ? 'var(--grn)' : 'var(--amb)' }}>{seo.total}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx3)' }}>{seo.total >= th ? `≥ threshold ${th}` : `below threshold ${th}`}</span>
                    </div>
                    {sel.seoLoops > 0 && (
                      <div style={{ background: 'rgba(19,122,91,.08)', borderRadius: 7, padding: '8px 10px', fontSize: 10.5, color: 'var(--grn)', lineHeight: 1.55, marginTop: 8 }}>
                        Passed after {sel.seoLoops} automatic SEO regeneration{sel.seoLoops > 1 ? 's' : ''} — suggestions fed back to ChatGPT until ≥ {th}
                        {sel.appliedSugs.length > 0 && (
                          <div style={{ marginTop: 6, color: 'var(--tx2)' }}>
                            <span className="microlabel" style={{ fontSize: 8.5 }}>Suggestions applied on regeneration</span>
                            {sel.appliedSugs.map((s, i) => (
                              <div key={i} style={{ marginTop: 3 }}>✓ {s}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <ScoreBar label="Keyword density" value={seo.kw} />
                    <ScoreBar label="Readability" value={seo.read} />
                    <ScoreBar label="Heading structure" value={seo.head} />
                    <ScoreBar label="Meta tags" value={seo.meta} />
                    {seo.sugs.length > 0 && (
                      <>
                        <MicroLabel style={{ marginTop: 12 }}>Suggestions</MicroLabel>
                        {seo.sugs.map((s, i) => (
                          <div key={i} style={{ display: 'flex', gap: 7, fontSize: 11, color: 'var(--tx1)', lineHeight: 1.5, marginTop: 6 }}>
                            <span style={{ color: 'var(--ambH)' }}>→</span> {s}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Actions card */}
              <div className="card" style={{ padding: '14px 17px', marginTop: 14 }}>
                {!revising ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button className={`btn btn-primary ${editorDim}`} onClick={approve}>Approve → deploy</button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setEditT(sel.draft?.title ?? '');
                        setEditM(sel.draft?.meta ?? '');
                        setEditing(true);
                        setTab('blog');
                      }}
                    >
                      Edit draft
                    </button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={remake}>Remake</button>
                      <button className={`btn btn-red ${editorDim}`} style={{ flex: 1 }} onClick={reject}>Reject</button>
                    </div>
                    <button className={`btn btn-red ${editorDim}`} onClick={() => setRevising(true)}>Request revision</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea
                      className="nf-input"
                      rows={3}
                      placeholder="What should the model change? e.g. tighten keyword usage in intro, trim meta description"
                      value={revNote}
                      onChange={(e) => setRevNote(e.target.value)}
                    />
                    <button className={`btn btn-redsolid ${editorDim}`} onClick={sendRevision}>Send back to generation</button>
                    <button className="btn btn-ghost" onClick={() => setRevising(false)}>Cancel</button>
                  </div>
                )}
                <p style={{ fontSize: 10.5, color: 'var(--tx3)', lineHeight: 1.6, marginTop: 11, marginBottom: 0 }}>
                  {user?.role === 'editor'
                    ? 'Signed in as editor — you can edit drafts and payloads, but approve/publish needs an admin or reviewer. Every action is logged with your user id.'
                    : 'Approval deploys the post, then ad, email and social payloads pause at a distribution gate — nothing publishes without a second sign-off.'}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Distribution gate card (§7.5) */}
              <div className="card" style={{ padding: '14px 17px' }}>
                <MicroLabel style={{ color: 'var(--cyn)' }}>Distribution gate</MicroLabel>
                <p style={{ fontSize: 11.5, color: 'var(--tx1)', lineHeight: 1.6, marginTop: 7, marginBottom: 0 }}>
                  Generated from the approved post. Publish jobs are not enqueued until you approve below.
                </p>
                {[
                  { k: 'ads' as const, tab: 'ads' as Tab, name: 'Meta Ads', sub: 'LEADGEN campaign · sandbox · limiter 10 req/10s' },
                  { k: 'email' as const, tab: 'email' as Tab, name: 'ActiveCampaign', sub: '1,842 subscribers + ad-leads segment · limiter 5 req/s' },
                  { k: 'social' as const, tab: 'social' as Tab, name: 'Organic social', sub: 'LinkedIn · Facebook · Instagram · non-blocking' }
                ].map((c) => (
                  <button
                    key={c.k}
                    className="rowhover"
                    onClick={() => setTab(c.tab)}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '9px 6px', borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', borderBottom: '1px solid var(--line2)' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--tx)' }}>
                        {c.name}
                        {edited[c.k] && (
                          <span className="pill" style={{ marginLeft: 7, color: 'var(--amb)', background: 'rgba(217,119,6,.12)' }}>edited</span>
                        )}
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--tx3)', marginTop: 2 }}>{c.sub}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--grn)', flexShrink: 0 }}>will publish</span>
                  </button>
                ))}
              </div>

              {/* Publish card */}
              <div className="card" style={{ padding: '14px 17px', marginTop: 14 }}>
                <div className="microlabel" style={{ marginBottom: 8 }}>Channels to publish</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
                  {([['ads', 'Meta Ads'], ['email', 'Email (ActiveCampaign)'], ['social', 'Social (LinkedIn · Facebook · Instagram)']] as const).map(
                    ([k, label]) => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={chan[k]} onChange={(e) => setChan((c) => ({ ...c, [k]: e.target.checked }))} />
                        <span style={{ color: chan[k] ? 'var(--tx)' : 'var(--tx3)' }}>{label}</span>
                      </label>
                    )
                  )}
                </div>
                <button
                  className={`btn btn-primary ${editorDim}`}
                  style={{ width: '100%', opacity: !chan.ads && !chan.email && !chan.social ? 0.5 : undefined }}
                  onClick={publishAll}
                >
                  Approve &amp; Publish{' '}
                  {chan.ads && chan.email && chan.social
                    ? 'All'
                    : (['ads', 'email', 'social'] as const).filter((k) => chan[k]).length + ' selected'}
                </button>
                <p style={{ fontSize: 10.5, color: 'var(--tx3)', lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
                  Uncheck any channel to skip it for this run — deselected channels are marked “skipped” in the pipeline, not failed. Nothing is
                  enqueued until this approval; edits are saved as manual overrides and logged.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {preview && sel && <PreviewModal run={sel} onClose={() => setPreview(false)} />}
    </div>
  );
}

function PendingPlaceholder() {
  return (
    <div style={{ border: '1px dashed var(--line5)', borderRadius: 8, padding: '32px 24px', textAlign: 'center' }}>
      <div className="microlabel">payloads pending</div>
      <p style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.65, maxWidth: 420, margin: '8px auto 0' }}>
        Ad creative is generated right after content approval and WordPress deploy, then pauses here at the distribution gate for your review.
      </p>
    </div>
  );
}
