import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { MicroLabel, Toggle, Avatar } from '../components/ui';

// Settings page (DESIGN_SPEC §8.8): workflow gates, brand voice + UTM,
// Karbon trigger, active adapters, team & access (admin invites).

interface Member { id: string; first: string; last: string; initials: string; email: string; role: string; }

const ROLE_PILL: Record<string, { c: string; bg: string }> = {
  admin: { c: 'var(--grn)', bg: 'rgba(19,122,91,.11)' },
  reviewer: { c: 'var(--vio)', bg: 'rgba(91,79,194,.11)' },
  editor: { c: 'var(--amb)', bg: 'rgba(180,83,9,.11)' }
};

export default function Settings() {
  const { user } = useAuth();
  const { showToast } = useApp();
  const isAdmin = user?.role === 'admin';

  const [threshold, setThreshold] = useState(80);
  const [auto, setAuto] = useState(false);
  const [conc, setConc] = useState(3);
  const [adapters, setAdapters] = useState({ ads: true, email: true, social: true });
  const [brandVoice, setBrandVoice] = useState('');
  const [bvSavedAt, setBvSavedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [secretShown, setSecretShown] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [inv, setInv] = useState({ first: '', last: '', email: '', role: 'editor' });
  const [invMsg, setInvMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const [s, u] = await Promise.all([
      api.get<{ settings: Record<string, unknown> }>('/api/settings'),
      api.get<{ users: Member[] }>('/api/users')
    ]);
    const st = s.settings;
    setThreshold(Number(st.seo_auto_approve_threshold ?? 80));
    setAuto(st.auto_approve_enabled === true);
    setConc(Number(st.max_concurrency ?? 3));
    setAdapters((st.adapters_enabled as { ads: boolean; email: boolean; social: boolean }) ?? { ads: true, email: true, social: true });
    setBrandVoice(String(st.brand_voice ?? ''));
    setMembers(u.users);
  }, []);

  useEffect(() => { load(); }, [load]);

  const put = async (key: string, value: unknown) => {
    if (!isAdmin) { showToast('Only admins can change settings'); return false; }
    await api.put(`/api/settings/${key}`, { value }).catch(() => undefined);
    return true;
  };

  const [inviteLink, setInviteLink] = useState('');
  const invite = async () => {
    const first = inv.first.trim(); const email = inv.email.trim().toLowerCase();
    if (!first || !email) { setInvMsg({ text: 'First name and email are required.', ok: false }); return; }
    if (email.indexOf('@') < 1) { setInvMsg({ text: 'Enter a valid email address.', ok: false }); return; }
    try {
      const r = await api.post<{ setPasswordPath: string }>('/api/users', {
        first, last: inv.last.trim(), email, role: inv.role
      });
      setInv({ first: '', last: '', email: '', role: 'editor' });
      setInviteLink(`${window.location.origin}${r.setPasswordPath}`);
      setInvMsg({ text: `Invited ${first} as ${inv.role}. Share the set-password link below — they set a password, then sign in.`, ok: true });
      await load();
    } catch (err) {
      setInviteLink('');
      if (err instanceof ApiError && (err.status === 409 || err.status === 400)) setInvMsg({ text: err.message, ok: false });
      else setInvMsg({ text: 'Invite failed — try again.', ok: false });
    }
  };

  const adapterDefs = [
    { key: 'ads' as const, name: 'Meta Ads', phase: 'Phase 3', phC: 'var(--amb)', phBg: 'rgba(180,83,9,.12)', desc: 'Lead-gen campaign per post · sandbox until review · limiter 10 req/10s' },
    { key: 'email' as const, name: 'ActiveCampaign email', phase: 'Phase 2', phC: 'var(--vio)', phBg: 'rgba(91,79,194,.1)', desc: 'Campaign to subscribers + ad leads · limiter 5 req/s' },
    { key: 'social' as const, name: 'Organic social', phase: 'Phase 2', phC: 'var(--vio)', phBg: 'rgba(91,79,194,.1)', desc: 'LinkedIn · Facebook · Instagram announcements' }
  ];

  const hr = <div style={{ height: 1, background: 'var(--line2)', margin: '14px 0' }} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 980 }}>
      {/* ── left column ── */}
      <div>
        <div className="card" style={{ padding: '16px 19px' }}>
          <MicroLabel>Workflow gates</MicroLabel>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 11 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>SEO auto-approve threshold</span>
            <span className="disp" style={{ fontSize: 24, fontWeight: 700, color: 'var(--grn)' }}>{threshold}</span>
          </div>
          <input
            type="range" min={50} max={100} step={1} value={threshold} disabled={!isAdmin}
            onChange={(e) => setThreshold(Number(e.target.value))}
            onMouseUp={() => put('seo_auto_approve_threshold', threshold)}
            onTouchEnd={() => put('seo_auto_approve_threshold', threshold)}
            style={{ width: '100%', accentColor: 'var(--grn)', marginTop: 8 }}
          />
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--tx4)' }}>
            <span>50</span><span>100</span>
          </div>
          {hr}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>Auto-approve above threshold</span>
            <Toggle on={auto} disabled={!isAdmin} onClick={async () => { const v = !auto; if (await put('auto_approve_enabled', v)) setAuto(v); }} />
          </div>
          <p style={{ fontSize: 10.5, color: auto ? 'var(--amb)' : 'var(--tx3)', lineHeight: 1.6, margin: '7px 0 0' }}>
            {auto
              ? `On — runs scoring ≥ ${threshold} skip the content gate (logged as auto-approved). Distribution review still requires a human.`
              : 'Off — every draft pauses for human review regardless of score. Distribution payloads always need a human.'}
          </p>
          {hr}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>Max concurrent workflows</div>
              <div style={{ fontSize: 10.5, color: 'var(--tx3)' }}>BullMQ worker concurrency per queue</div>
            </div>
            <button className="btn btn-ghost" style={{ padding: '4px 11px' }} onClick={async () => { const v = Math.max(1, conc - 1); if (await put('max_concurrency', v)) setConc(v); }}>–</button>
            <span className="disp" style={{ fontSize: 17, fontWeight: 600, width: 24, textAlign: 'center' }}>{conc}</span>
            <button className="btn btn-ghost" style={{ padding: '4px 11px' }} onClick={async () => { const v = Math.min(10, conc + 1); if (await put('max_concurrency', v)) setConc(v); }}>+</button>
          </div>
          {hr}
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>Retry policy</div>
          <div className="codebox" style={{ marginTop: 7 }}>
            3 attempts · backoff 2s → 4s → 8s · terminal failure posts “Workflow Failed” to Karbon timeline
          </div>
          {hr}
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>Queue rate limits</div>
          <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 3 }}>BullMQ limiters on strict APIs — prevents HTTP 429</div>
          <div className="codebox" style={{ marginTop: 7 }}>meta-ads · 10 req / 10s&nbsp;&nbsp;·&nbsp;&nbsp;activecampaign · 5 req / s</div>
        </div>

        <div className="card" style={{ padding: '16px 19px', marginTop: 14 }}>
          <MicroLabel>Global brand voice</MicroLabel>
          <p style={{ fontSize: 10.5, color: 'var(--tx3)', margin: '7px 0 0', lineHeight: 1.6 }}>
            Injected into every generation request — sent to the ChatGPT Business API generation call and prepended to the GPT-4o system prompt for distribution copy.
          </p>
          <textarea
            className="nf-input" rows={5} disabled={!isAdmin} style={{ marginTop: 9, fontSize: 12, lineHeight: 1.65 }}
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            onBlur={async () => { if (await put('brand_voice', brandVoice)) setBvSavedAt(Date.now()); }}
          />
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--tx4)', marginTop: 5 }}>
            <span>{brandVoice.length} chars</span>
            {Date.now() - bvSavedAt < 3000 && <span style={{ color: 'var(--grn)' }}>saved ✓ · applies to next run</span>}
          </div>
          {hr}
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>UTM enforcement</div>
          <p style={{ fontSize: 10.5, color: 'var(--tx3)', margin: '5px 0 0', lineHeight: 1.55 }}>
            Adapters append channel parameters to every outbound link at publish — manual edits can't strip them.
          </p>
          <div className="codebox" style={{ marginTop: 8 }}>
            meta_ads · paid_social<br />activecampaign · email<br />linkedin | facebook · organic_social<br />utm_campaign = run slug — all channels
          </div>
        </div>
      </div>

      {/* ── right column ── */}
      <div>
        <div className="card" style={{ padding: '16px 19px' }}>
          <MicroLabel>Karbon trigger</MicroLabel>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 11 }}>Webhook endpoint</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 7, alignItems: 'center' }}>
            <div className="codebox" style={{ flex: 1 }}>POST /api/webhooks/karbon</div>
            <button
              className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 11.5 }}
              onClick={() => {
                navigator.clipboard?.writeText(`${window.location.origin}/api/webhooks/karbon`).catch(() => undefined);
                setCopied(true); window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 6, lineHeight: 1.55 }}>
            HMAC middleware verifies signature before body parse · binds 0.0.0.0:$PORT on Railway
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 13 }}>HMAC signing secret (SHA-256)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 7, alignItems: 'center' }}>
            <div className="codebox" style={{ flex: 1 }}>{secretShown ? 'whk_4f2c9a81d7e35b60' : 'whk_ ••••••••••••'}</div>
            <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 11.5 }} onClick={() => setSecretShown((v) => !v)}>
              {secretShown ? 'Hide' : 'Reveal'}
            </button>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 13 }}>Idempotency</div>
          <div className="codebox" style={{ marginTop: 7 }}>
            Redis SETNX idem:{'{'}workItemId{'}'}:{'{'}stageId{'}'} · TTL 24h — duplicate deliveries ignored
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 13 }}>Trigger stage</div>
          <div className="codebox" style={{ marginTop: 7 }}>Work item → "Marketing Content — Ready"</div>
          <div style={{ background: 'rgba(217,119,6,.08)', borderRadius: 7, padding: '9px 11px', fontSize: 10.5, color: 'var(--amb)', lineHeight: 1.6, marginTop: 12 }}>
            Live webhook is Phase 3 — until then, use "Simulate Karbon trigger" which posts an identical signed payload.
            <div style={{ color: 'var(--tx3)', marginTop: 5 }}>
              Each delivery fans out to exactly 3 content sets (blog + lead magnet + distribution payloads) — one WorkflowRun per set.
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 19px', marginTop: 14 }}>
          <MicroLabel>Active adapters</MicroLabel>
          {adapterDefs.map((a) => {
            const on = adapters[a.key];
            return (
              <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {a.name}{' '}
                    <span className="pill" style={{ marginLeft: 5, color: a.phC, background: a.phBg }}>{a.phase}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 2 }}>{a.desc}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, color: on ? 'var(--grn)' : 'var(--tx4)' }}>{on ? 'active' : 'skipped'}</span>
                <Toggle
                  on={on} disabled={!isAdmin}
                  onClick={async () => {
                    const next = { ...adapters, [a.key]: !on };
                    if (await put('adapters_enabled', next)) setAdapters(next);
                  }}
                />
              </div>
            );
          })}
          <p style={{ fontSize: 10.5, color: 'var(--tx3)', lineHeight: 1.6, margin: '10px 0 0' }}>
            Disabled adapters are skipped by the saga — downstream stages still run. WordPress is the active CMS adapter; Ghost + Webflow ship later via the same PublisherAdapter interface.
          </p>
        </div>

        <div className="card" style={{ padding: '16px 19px', marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <MicroLabel>Team &amp; access</MicroLabel>
            <span className="pill" style={{ color: 'var(--grn)', background: 'rgba(19,122,91,.11)' }}>invite-only</span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--tx3)', margin: '7px 0 0', lineHeight: 1.6 }}>
            Only invited accounts can sign in — there is no open sign-up.{' '}
            {isAdmin ? 'As an admin you can invite teammates below; new accounts default to editor.' : 'Ask an admin to invite new teammates.'}
          </p>
          <div style={{ marginTop: 6 }}>
            {members.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg5)', color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 600, flexShrink: 0 }}>
                  {m.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{m.first} {m.last}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{m.email}</div>
                </div>
                <span className="pill" style={{ color: ROLE_PILL[m.role]?.c, background: ROLE_PILL[m.role]?.bg }}>{m.role}</span>
              </div>
            ))}
          </div>
          {isAdmin && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input className="nf-input" placeholder="First name" value={inv.first} onChange={(e) => setInv({ ...inv, first: e.target.value })} />
                <input className="nf-input" placeholder="Last name" value={inv.last} onChange={(e) => setInv({ ...inv, last: e.target.value })} />
              </div>
              <input className="nf-input" style={{ marginTop: 8 }} placeholder="name@elementaccounting.ca" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <select className="nf-input" style={{ flex: 1 }} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
                  <option value="editor">Editor — draft only, can't approve/publish</option>
                  <option value="reviewer">Reviewer — approve content + distribution</option>
                  <option value="admin">Admin — full access</option>
                </select>
                <button className="btn btn-primary" style={{ padding: '7px 16px' }} onClick={invite}>Invite</button>
              </div>
              {invMsg && <div style={{ fontSize: 11, marginTop: 8, color: invMsg.ok ? 'var(--grn)' : 'var(--amb)', lineHeight: 1.5 }}>{invMsg.text}</div>}
              {inviteLink && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <div className="codebox" style={{ flex: 1, overflowX: 'auto', whiteSpace: 'nowrap' }}>{inviteLink}</div>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '7px 12px', fontSize: 11.5 }}
                    onClick={() => navigator.clipboard?.writeText(inviteLink).catch(() => undefined)}
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
