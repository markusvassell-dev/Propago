import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Run, AdsPayload, EmailPayload, SocialPayload } from '../lib/types';
import { MicroLabel, KeywordChip, ScoreBar } from '../components/ui';
import PdfSheet from '../components/PdfSheet';
import PreviewModal from '../components/PreviewModal';
import { FacebookPreview, LinkedInPreview, InstagramPreview, MetaAdPreview, EmailPreview } from '../components/ChannelPreviews';
import { fmtAgo, slug3Of } from '../lib/format';

// Review queue (DESIGN_SPEC §7) — all three human gates in one page.
//   Gate ① (review):       Blog tab. Approve (WP draft → live) / edit / revision
//                          / remake / reject. Nothing is public yet, so reject
//                          discards the whole run.
//   Gate ② (socialreview): LinkedIn / Facebook / Instagram captions. Approve
//                          posts them; skip / regenerate / abort.
//   Gate ③ (distreview):   Meta Ads + Email. Approve publishes them; skip /
//                          regenerate / abort.
// Gates ② and ③ come AFTER the post is live, so neither can discard the run —
// abort stops what's left, it never retracts what's already public.

type Tab = 'blog' | 'ads' | 'email' | 'social';

const emptyAds: AdsPayload = { headline: '', primary: '', link: '' };
const emptyEmail: EmailPayload = { subject: '', body: '' };
const emptySocial: SocialPayload = { linkedin: '', facebook: '', instagram: '' };

/** Channel keys, split by which gate releases them. */
const SOCIAL_KEYS = ['linkedin', 'facebook', 'instagram'] as const;
const DIST_KEYS = ['ads', 'email'] as const;
type ChannelKey = (typeof SOCIAL_KEYS)[number] | (typeof DIST_KEYS)[number];
type ChannelPicks = Record<ChannelKey, boolean>;
const allOn: ChannelPicks = { linkedin: true, facebook: true, instagram: true, ads: true, email: true };
const CHANNEL_LABEL: Record<ChannelKey, string> = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  ads: 'Meta Ads',
  email: 'Email (ActiveCampaign)'
};

/** Stage index each gate waits at — positional into stage_state (17 stages). */
const GATE_STAGE_IDX: Record<string, number> = { review: 5, socialreview: 8, distreview: 13 };

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
  // Per-run channel picks at the publish gates (default all on). Gate ② owns
  // the three platform keys, gate ③ owns ads + email.
  const [chan, setChan] = useState<ChannelPicks>({ ...allOn });
  const [aborting, setAborting] = useState(false);
  const [abortReason, setAbortReason] = useState('');
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
  const isSocial = sel?.status === 'socialreview';
  const isDist = sel?.status === 'distreview';
  // Anything past gate ①: the blog post is already public.
  const isPostLive = isSocial || isDist;

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
    setTab(sel.status === 'distreview' ? 'ads' : sel.status === 'socialreview' ? 'social' : 'blog');
    setChan({ ...allOn });
    setEditing(false);
    setRevising(false);
    setAborting(false);
    setAbortReason('');
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
      showToast(`${sel.wf} approved by ${user!.handle} → WordPress draft going live`);
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

  /** Gate ③ — Meta Ads + ActiveCampaign email. */
  const publishAll = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t publish — admin or reviewer required');
    const on = DIST_KEYS.filter((k) => chan[k]);
    if (!on.length) return showToast('Select at least one channel, or use Skip');
    try {
      // Only save edits for channels actually being published.
      if (chan.ads) await api.patch(`/api/runs/${sel.id}/distribution/meta_ads`, ads);
      if (chan.email) await api.patch(`/api/runs/${sel.id}/distribution/ac_email`, email);
      await api.post(`/api/runs/${sel.id}/publish-all`, { channels: chan });
      showToast(`${sel.wf} → publishing ${on.map((k) => CHANNEL_LABEL[k]).join(' · ')}`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already published by ${who} — nothing overwritten`);
    }
  };

  /** Gate ② — LinkedIn / Facebook / Instagram. Approval posts immediately. */
  const approveSocial = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t publish — admin or reviewer required');
    const on = SOCIAL_KEYS.filter((k) => chan[k]);
    if (!on.length) return showToast('Select at least one platform, or use Skip');
    try {
      await api.patch(`/api/runs/${sel.id}/distribution/social`, social);
      await api.post(`/api/runs/${sel.id}/approve-social`, { channels: chan });
      showToast(`${sel.wf} → posting to ${on.map((k) => CHANNEL_LABEL[k]).join(' · ')}`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — nothing overwritten`);
    }
  };

  /** Skip this batch and continue the run (gates ② and ③). */
  const skipBatch = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t skip — admin or reviewer required');
    const path = isSocial ? 'skip-social' : 'skip-distribution';
    try {
      await api.post(`/api/runs/${sel.id}/${path}`);
      showToast(isSocial ? `${sel.wf} → social skipped · generating ads and email` : `${sel.wf} → ads and email skipped · completing`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — nothing overwritten`);
    }
  };

  /** Throw this batch away and have GPT write it again (gates ② and ③). */
  const regenerateBatch = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t regenerate — admin or reviewer required');
    const path = isSocial ? 'regenerate-social' : 'regenerate-distribution';
    try {
      await api.post(`/api/runs/${sel.id}/${path}`, { note: revNote });
      setRevNote('');
      setRevising(false);
      showToast(`${sel.wf} → regenerating ${isSocial ? 'social captions' : 'ad creative and email'}`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — nothing sent`);
    }
  };

  /** Terminal stop. Published content stays published — see abortRun(). */
  const abort = async () => {
    if (!sel) return;
    if (!canApprove) return showToast('Editor role can’t abort — admin or reviewer required');
    try {
      await api.post(`/api/runs/${sel.id}/abort`, { reason: abortReason });
      setAbortReason('');
      setAborting(false);
      showToast(`${sel.wf} aborted — published content stays live, remaining channels cancelled`);
      await Promise.all([load(), refreshRuns()]);
    } catch (err) {
      conflictToast(err, (wf, who) => `${wf} was already handled by ${who} — nothing overwritten`);
    }
  };

  // ---- §7.1 empty state ----
  if (!sel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 90, textAlign: 'center' }}>
        <MicroLabel>queue clear</MicroLabel>
        <div className="disp" style={{ fontSize: 19, fontWeight: 600, marginTop: 8 }}>0 drafts awaiting review</div>
        <p style={{ fontSize: 12, color: 'var(--tx2)', maxWidth: 440, lineHeight: 1.65, marginTop: 8 }}>
          Runs pause here three times — the blog draft after SEO scoring, then the social captions, then the ad and email copy. Each gate releases
          only its own batch.
        </p>
      </div>
    );
  }

  const seo = sel.seo;
  const th = 80;
  const waitSince = sel.stages[GATE_STAGE_IDX[sel.status] ?? 5]?.startedAt ?? sel.updatedAt;
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
  const gateKeys = isSocial ? SOCIAL_KEYS : DIST_KEYS;
  const activeCount = gateKeys.filter((k) => chan[k]).length;
  const totalCount = gateKeys.length;
  // All three captions live in one payload, so any social edit marks all three.
  const editedFor = (k: ChannelKey): boolean =>
    k === 'ads' ? edited.ads : k === 'email' ? edited.email : edited.social;

  return (
    <div>
      {/* §7.2 card strip */}
      <MicroLabel>Awaiting review · {items.length}</MicroLabel>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '10px 2px 4px' }}>
        {items.map((i) => {
          const isSel = i.id === sel.id;
          const gatePill =
            i.status === 'distreview'
              ? { label: 'ads + email', color: 'var(--cyn)', bg: 'rgba(14,116,144,.1)' }
              : i.status === 'socialreview'
                ? { label: 'social', color: 'var(--vio)', bg: 'rgba(91,79,194,.1)' }
                : { label: 'content', color: 'var(--vio)', bg: 'rgba(91,79,194,.1)' };
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
                <span className="pill" style={{ color: gatePill.color, background: gatePill.bg }}>
                  {gatePill.label}
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
                {i.client} · waiting {fmtAgo(i.stages[GATE_STAGE_IDX[i.status] ?? 5]?.startedAt ?? i.updatedAt).replace(' ago', '')}
              </div>
            </button>
          );
        })}
      </div>

      {/* §7.3 main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 14, marginTop: 10 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          {peer && (
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
                <span className="pill" style={isPostLive ? { color: 'var(--grn)', background: 'rgba(19,122,91,.12)' } : { color: 'var(--vio)', background: 'rgba(91,79,194,.14)' }}>
                  {isPostLive ? 'published' : 'wp draft'}
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
              <PendingPlaceholder what="Ad creative" after="the social batch is approved or skipped" />
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
                  <div style={{ marginTop: 16, maxWidth: 380 }}>
                    <MicroLabel>Preview — updates as you edit</MicroLabel>
                    <div style={{ marginTop: 7 }}>
                      <MetaAdPreview headline={ads.headline} primaryText={ads.primary} url={ads.link} />
                    </div>
                  </div>
                </div>
              </div>
            ))}

          {/* ── Email tab ── */}
          {tab === 'email' &&
            (!isDist ? (
              <PendingPlaceholder what="Campaign email" after="the social batch is approved or skipped" />
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
                  <div style={{ marginTop: 16, maxWidth: 400 }}>
                    <MicroLabel>Preview — the branded template subscribers receive</MicroLabel>
                    <div style={{ marginTop: 7 }}>
                      <EmailPreview subject={email.subject} body={email.body} title={sel.draft?.title ?? sel.topic} />
                    </div>
                  </div>
                </div>
              </div>
            ))}

          {/* ── Social tab ── */}
          {tab === 'social' &&
            (!isPostLive ? (
              <PendingPlaceholder what="Social captions" after="the post goes live" />
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
                    <div style={{ marginTop: 10, maxWidth: 360 }}>
                      {p.k === 'linkedin' && <LinkedInPreview caption={social.linkedin} title={sel.draft?.title ?? sel.topic} url={sel.draft?.liveUrl ?? ''} />}
                      {p.k === 'facebook' && <FacebookPreview caption={social.facebook} title={sel.draft?.title ?? sel.topic} url={sel.draft?.liveUrl ?? ''} />}
                      {p.k === 'instagram' && <InstagramPreview caption={social.instagram} title={sel.draft?.title ?? sel.topic} />}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 12 }}>{utmChip(`?utm_source={platform}&utm_medium=organic_social&utm_campaign=${slug3Of(sel.topic)}`)}</div>
              </div>
            ))}
        </div>

        {/* ── right rail ── */}
        <div>
          {!isPostLive ? (
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
                    {/* Weighted drag: the bars show raw component scores, but
                        the score is weighted (kw 30 · read 30 · head 20 · meta
                        20). Name the component actually costing the most points
                        so the fix is obvious without doing the arithmetic. */}
                    {(() => {
                      const parts = [
                        { label: 'Keyword density', value: seo.kw, weight: 0.3 },
                        { label: 'Readability', value: seo.read, weight: 0.3 },
                        { label: 'Heading structure', value: seo.head, weight: 0.2 },
                        { label: 'Meta tags', value: seo.meta, weight: 0.2 }
                      ].map((p) => ({ ...p, lost: Math.round((100 - p.value) * p.weight) }));
                      const worst = parts.reduce((a, b) => (b.lost > a.lost ? b : a));
                      if (worst.lost < 3) return null;
                      return (
                        <div style={{ background: 'rgba(180,83,9,.08)', borderRadius: 7, padding: '8px 10px', marginTop: 10, fontSize: 10.5, lineHeight: 1.55, color: 'var(--tx1)' }}>
                          <strong style={{ color: 'var(--amb)' }}>Biggest drag: {worst.label}</strong> — {worst.value}/100 at {Math.round(worst.weight * 100)}% weight is costing about {worst.lost} point{worst.lost === 1 ? '' : 's'}.
                          {worst.label === 'Keyword density' && seo.kw === 50 && (
                            <div style={{ marginTop: 4, color: 'var(--tx2)' }}>
                              A flat 50 usually means no target keywords were supplied for this run — the scorer can’t grade density without a primary keyword.
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                    <button className={`btn btn-primary ${editorDim}`} onClick={approve}>Approve → publish live</button>
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
                    : 'Approval flips the WordPress draft to published, then social captions pause at gate ②, and ad + email copy at gate ③ — each batch needs its own sign-off.'}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Publish gate card (§7.5) — gate ② social, gate ③ ads + email */}
              <div className="card" style={{ padding: '14px 17px' }}>
                <MicroLabel style={{ color: isSocial ? 'var(--vio)' : 'var(--cyn)' }}>
                  {isSocial ? 'Social gate ②' : 'Ads + email gate ③'}
                </MicroLabel>
                <p style={{ fontSize: 11.5, color: 'var(--tx1)', lineHeight: 1.6, marginTop: 7, marginBottom: 0 }}>
                  {isSocial
                    ? 'Written from the published post. Approving posts to the selected platforms immediately, then ad and email copy is generated.'
                    : 'Written from the published post and the social batch. Approving is the last step before the run reports back to Karbon.'}
                </p>
                {(isSocial
                  ? [
                      { k: 'linkedin' as ChannelKey, tab: 'social' as Tab, name: 'LinkedIn', sub: 'UGC Posts API · personal profile' },
                      { k: 'facebook' as ChannelKey, tab: 'social' as Tab, name: 'Facebook', sub: 'Graph API · page feed' },
                      { k: 'instagram' as ChannelKey, tab: 'social' as Tab, name: 'Instagram', sub: 'Graph API · no links, link in bio' }
                    ]
                  : [
                      { k: 'ads' as ChannelKey, tab: 'ads' as Tab, name: 'Meta Ads', sub: 'LEADGEN campaign · launches PAUSED · 10 req/10s' },
                      { k: 'email' as ChannelKey, tab: 'email' as Tab, name: 'ActiveCampaign', sub: 'Subscribers + ad-leads segment · 5 req/s' }
                    ]
                ).map((c) => (
                  <button
                    key={c.k}
                    className="rowhover"
                    onClick={() => setTab(c.tab)}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '9px 6px', borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', borderBottom: '1px solid var(--line2)' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--tx)' }}>
                        {c.name}
                        {editedFor(c.k) && (
                          <span className="pill" style={{ marginLeft: 7, color: 'var(--amb)', background: 'rgba(217,119,6,.12)' }}>edited</span>
                        )}
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--tx3)', marginTop: 2 }}>{c.sub}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 10, color: chan[c.k] ? 'var(--grn)' : 'var(--tx3)', flexShrink: 0 }}>
                      {chan[c.k] ? 'will publish' : 'skipped'}
                    </span>
                  </button>
                ))}
              </div>

              {/* Publish / skip / regenerate / abort */}
              <div className="card" style={{ padding: '14px 17px', marginTop: 14 }}>
                {!revising && !aborting && (
                  <>
                    <div className="microlabel" style={{ marginBottom: 8 }}>
                      {isSocial ? 'Platforms to post' : 'Channels to publish'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
                      {(isSocial ? SOCIAL_KEYS : DIST_KEYS).map((k) => (
                        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                          <input type="checkbox" checked={chan[k]} onChange={(e) => setChan((c) => ({ ...c, [k]: e.target.checked }))} />
                          <span style={{ color: chan[k] ? 'var(--tx)' : 'var(--tx3)' }}>{CHANNEL_LABEL[k]}</span>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button
                        className={`btn btn-primary ${editorDim}`}
                        style={{ width: '100%', opacity: activeCount === 0 ? 0.5 : undefined }}
                        onClick={isSocial ? approveSocial : publishAll}
                      >
                        {isSocial ? 'Approve & Post' : 'Approve & Publish'}{' '}
                        {activeCount === totalCount ? 'All' : `${activeCount} selected`}
                      </button>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={skipBatch}>Skip</button>
                        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setRevising(true)}>Regenerate</button>
                      </div>
                      <button className={`btn btn-red ${editorDim}`} onClick={() => setAborting(true)}>Abort run</button>
                    </div>
                    <p style={{ fontSize: 10.5, color: 'var(--tx3)', lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
                      Unchecked channels are marked “skipped” in the pipeline, not failed. Skip passes on this batch entirely and moves the run
                      forward. Edits are saved as manual overrides and logged.
                    </p>
                  </>
                )}

                {revising && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="microlabel">Regenerate {isSocial ? 'captions' : 'ad creative + email'}</div>
                    <textarea
                      className="nf-input"
                      rows={3}
                      placeholder={isSocial ? 'What should change? e.g. lead with the stat, drop the hashtags' : 'What should change? e.g. sharper headline, shorter email'}
                      value={revNote}
                      onChange={(e) => setRevNote(e.target.value)}
                    />
                    <button className={`btn btn-redsolid ${editorDim}`} onClick={regenerateBatch}>Send back to generation</button>
                    <button className="btn btn-ghost" onClick={() => setRevising(false)}>Cancel</button>
                  </div>
                )}

                {aborting && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="microlabel" style={{ color: 'var(--red)' }}>Abort run</div>
                    <p style={{ fontSize: 11, color: 'var(--tx1)', lineHeight: 1.6, margin: 0 }}>
                      The blog post is already live{isDist ? ' and the social posts are already published' : ''} — aborting cannot take
                      {isDist ? ' those' : ' it'} down. It cancels every remaining channel and reports the run back to Karbon as finished early.
                    </p>
                    <textarea
                      className="nf-input"
                      rows={2}
                      placeholder="Why? (recorded in the audit trail)"
                      value={abortReason}
                      onChange={(e) => setAbortReason(e.target.value)}
                    />
                    <button className={`btn btn-redsolid ${editorDim}`} onClick={abort}>Abort — cancel remaining channels</button>
                    <button className="btn btn-ghost" onClick={() => setAborting(false)}>Cancel</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {preview && sel && <PreviewModal run={sel} onClose={() => setPreview(false)} />}
    </div>
  );
}

function PendingPlaceholder({ what, after }: { what: string; after: string }) {
  return (
    <div style={{ border: '1px dashed var(--line5)', borderRadius: 8, padding: '32px 24px', textAlign: 'center' }}>
      <div className="microlabel">not generated yet</div>
      <p style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.65, maxWidth: 420, margin: '8px auto 0' }}>
        {what} is written once {after}, then pauses here for your review. Nothing is generated ahead of its gate.
      </p>
    </div>
  );
}
