import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { MicroLabel, Toggle } from '../components/ui';
import { fmtAgo } from '../lib/format';
import { ACCT_STATUS } from '../lib/types';

// Prompt & Orchestrator page (DESIGN_SPEC §8.3).

interface Preset {
  key: string;
  label: string;
  niche: string;
  audience: string;
  region: string;
  builtin?: boolean;
}
interface RegEntry { title: string; lev: number | null; status: string; run: string; t: number; }
interface Lead { name: string; email: string; synced: boolean; painField: string; source: string; t: number; }
interface GenPP { painPoint: string; topic: string; keywords: string[]; sourceInsight: string; }
interface IndustryGen {
  industry: string;
  region: string;
  audience: string;
  masterPrompt: string;
  painPoints: GenPP[];
  gptOnly: boolean;
  stub: boolean;
}

const PROMPT_TEMPLATE = (niche: string, audience: string) =>
  'ROLE: You are a market researcher for a financial advisory firm serving businesses with under-served pain points.\n\n' +
  `TARGET PAIN POINT: ${niche}\n` +
  `AUDIENCE: ${audience}\n\n` +
  'TASK: Scan recent local news, community forums and industry reports. Extract ONE concrete, underserved pain point this audience faces around money, tax, compliance or growth.\n\n' +
  'RETURN STRICT JSON: { "pain_point": "...", "source_insight": "..." }\n\n' +
  'RULES: The pain point must be specific enough to anchor a 1000+ word blog post and a lead magnet. No generic advice. Do NOT repeat any pain point already in the research registry — Levenshtein similarity > 0.7 counts as a duplicate; fetch another.';

export default function Orchestrator() {
  const { showToast, refreshRuns } = useApp();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeKey, setActiveKey] = useState('hs');
  const [niche, setNiche] = useState('');
  const [audience, setAudience] = useState('');
  const [customPP, setCustomPP] = useState<string[]>([]);
  const [customAud, setCustomAud] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [schedOn, setSchedOn] = useState(true);
  const [schedNext, setSchedNext] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [promptSavedAt, setPromptSavedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [np, setNp] = useState({ label: '', niche: '', aud: '', region: '' });
  const [npMsg, setNpMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [newPP, setNewPP] = useState('');
  const [newAud, setNewAud] = useState('');
  const [ppSaved, setPpSaved] = useState(false);
  const [audSaved, setAudSaved] = useState(false);
  const [feed, setFeed] = useState<RegEntry[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  // ── Target Industry generator (admin): generate → review → save as preset ──
  const [tiOpen, setTiOpen] = useState(false);
  const [ti, setTi] = useState({ industry: '', region: '', audience: '', count: 5 });
  const [tiBusy, setTiBusy] = useState(false);
  const [tiMsg, setTiMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [tiGen, setTiGen] = useState<IndustryGen | null>(null);
  const [tiKeep, setTiKeep] = useState<boolean[]>([]);

  const load = useCallback(async () => {
    const [s, reg, l] = await Promise.all([
      api.get<{ settings: Record<string, unknown>; schedulerNext: number | null }>('/api/settings'),
      api.get<{ entries: RegEntry[] }>('/api/registry?type=painpoint'),
      api.get<{ leads: Lead[] }>('/api/leads')
    ]);
    const st = s.settings;
    const ps = (st.presets as Preset[]) ?? [];
    const key = (st.active_preset as string) ?? 'hs';
    const active = ps.find((p) => p.key === key) ?? ps[0];
    setPresets(ps);
    setActiveKey(key);
    setNiche(active?.niche ?? '');
    setAudience(active?.audience ?? '');
    setCustomPP((st.custom_pain_points as string[]) ?? []);
    setCustomAud((st.custom_audiences as string[]) ?? []);
    setPrompt(((st.master_prompt as string) ?? null) || PROMPT_TEMPLATE(active?.niche ?? '', active?.audience ?? ''));
    setSchedOn(st.scheduler_enabled === true);
    setSchedNext(s.schedulerNext);
    setFeed(reg.entries.slice(0, 8));
    setLeads(l.leads.slice(0, 6));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const put = async (key: string, value: unknown) => {
    if (!isAdmin) {
      showToast('Only admins can change orchestrator settings');
      return false;
    }
    await api.put(`/api/settings/${key}`, { value });
    return true;
  };

  const applyPreset = async (key: string) => {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setActiveKey(key);
    setNiche(p.niche);
    setAudience(p.audience);
    const mp = PROMPT_TEMPLATE(p.niche, p.audience);
    setPrompt(mp);
    setSavedAt(Date.now());
    if (isAdmin) {
      await api.put('/api/settings/active_preset', { value: key }).catch(() => undefined);
      await api.put('/api/settings/master_prompt', { value: mp }).catch(() => undefined);
    }
  };

  const addPreset = async () => {
    const label = np.label.trim();
    const nicheV = np.niche.trim();
    if (!label || !nicheV) {
      setNpMsg({ text: 'Preset name and target pain point are both required.', ok: false });
      return;
    }
    if (presets.some((p) => p.label.toLowerCase() === label.toLowerCase())) {
      setNpMsg({ text: 'A preset with that name already exists.', ok: false });
      return;
    }
    const preset: Preset = {
      key: `cust-${Date.now()}`,
      label,
      niche: nicheV,
      audience: np.aud.trim() || 'General audience',
      region: np.region.trim() || '—'
    };
    const next = [...presets, preset];
    if (!(await put('presets', next))) return;
    setPresets(next);
    await applyPreset(preset.key);
    setNp({ label: '', niche: '', aud: '', region: '' });
    setNpMsg({ text: `Added “${label}” and made it active.`, ok: true });
  };

  const deletePreset = async (key: string) => {
    const p = presets.find((x) => x.key === key);
    if (!p || p.builtin) return;
    const next = presets.filter((x) => x.key !== key);
    if (!(await put('presets', next))) return;
    setPresets(next);
    if (activeKey === key) await applyPreset('hs');
  };

  // ── Target Industry: research an industry, review, then save as a preset ──
  const tiGenerate = async () => {
    if (!isAdmin) return setTiMsg({ text: 'Admins only', ok: false });
    if (!ti.industry.trim()) return setTiMsg({ text: 'Enter a target industry first.', ok: false });
    setTiBusy(true);
    setTiMsg({ text: 'Researching — live web search + generation, ~15–30s…', ok: true });
    try {
      const g = await api.post<IndustryGen>('/api/target-industry/generate', ti);
      setTiGen(g);
      setTiKeep(g.painPoints.map(() => true));
      setTiMsg({
        text: `${g.painPoints.length} pain point(s) found${g.gptOnly ? ' (GPT-only — no SerpAPI key)' : ' · web-grounded'}${g.stub ? ' · SAMPLE (no OpenAI key)' : ''}. Review below, then save.`,
        ok: true
      });
    } catch (e) {
      setTiGen(null);
      setTiMsg({ text: (e as Error).message || 'Generation failed', ok: false });
    } finally {
      setTiBusy(false);
    }
  };

  const tiSave = async (activate: boolean) => {
    if (!tiGen) return;
    const keep = tiGen.painPoints.filter((_, i) => tiKeep[i]);
    if (keep.length === 0) return setTiMsg({ text: 'Keep at least one pain point.', ok: false });
    setTiBusy(true);
    try {
      await api.post('/api/target-industry/save', {
        label: tiGen.industry,
        industry: tiGen.industry,
        region: tiGen.region,
        audience: tiGen.audience,
        masterPrompt: tiGen.masterPrompt,
        painPoints: keep,
        activate
      });
      await load();
      setTiMsg({ text: `Saved “${tiGen.industry}” with ${keep.length} pain point(s)${activate ? ' — now active' : ''}.`, ok: true });
      setTiGen(null);
      showToast(`Target industry saved — ${keep.length} pain point(s) added to the library`);
    } catch (e) {
      setTiMsg({ text: (e as Error).message || 'Save failed', ok: false });
    } finally {
      setTiBusy(false);
    }
  };

  const toggleSched = async () => {
    const next = !schedOn;
    if (!(await put('scheduler_enabled', next))) return;
    setSchedOn(next);
    const s = await api.get<{ schedulerNext: number | null }>('/api/settings');
    setSchedNext(s.schedulerNext);
  };

  const runNow = async () => {
    try {
      const r = await api.post<{ duplicate: boolean; workItemId: string; wfIds: string[] }>('/api/simulate-trigger');
      if (r.duplicate) showToast(`Duplicate delivery → idem:${r.workItemId}:mkt-ready already set · batch NOT re-triggered`);
      else showToast(`Webhook received · HMAC ✓ → ${r.wfIds.length} content sets queued (${r.wfIds.join(' · ')}) — one WorkflowRun per set`);
      await refreshRuns();
    } catch {
      showToast('Editor role can’t trigger runs — admin or reviewer required');
    }
  };

  const nextLabel = schedNext
    ? new Date(schedNext).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    : 'Mon 08:00';

  const knownPP = [...new Set([...presets.map((p) => p.niche), ...customPP])];
  const knownAud = [...new Set([...presets.map((p) => p.audience), ...customAud])];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 14 }}>
        {/* ── Master research prompt ── */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MicroLabel>Master research prompt</MicroLabel>
            {Date.now() - savedAt < 3000 && <span className="mono" style={{ fontSize: 10, color: 'var(--grn)' }}>saved ✓</span>}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--tx2)', margin: '7px 0 0', lineHeight: 1.6 }}>
            Extracts one underserved pain point per run — sent to the ChatGPT Business API, must return strict JSON.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13 }}>
            <span className="microlabel">pain point preset</span>
            <select className="nf-input" style={{ width: 'auto', flex: 1 }} value={activeKey} onChange={(e) => applyPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}{p.builtin ? '' : ' · custom'}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 11.5 }} onClick={() => setAddOpen((v) => !v)}>
              {addOpen ? 'Close' : '+ New preset'}
            </button>
          </div>

          {/* ── Target Industry: auto-research an industry into a preset ── */}
          {isAdmin && (
            <div style={{ marginTop: 12, border: '1px solid var(--line4)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => setTiOpen((v) => !v)}
                style={{ width: '100%', textAlign: 'left', background: 'var(--bg4)', border: 'none', cursor: 'pointer', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span className="microlabel" style={{ color: 'var(--tx)' }}>🎯 Target industry — auto-research pain points</span>
                <span style={{ marginLeft: 'auto', color: 'var(--tx3)', fontSize: 12 }}>{tiOpen ? '▾' : '▸'}</span>
              </button>

              {tiOpen && (
                <div style={{ padding: '13px 15px' }}>
                  <p style={{ fontSize: 11.5, color: 'var(--tx2)', margin: '0 0 10px', lineHeight: 1.6 }}>
                    Enter an industry you want to win clients in. Propago searches live web/news sources, writes a master research prompt
                    tailored to it, and proposes concrete pain points. Nothing is saved until you review and click save.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                    <input className="nf-input" placeholder="Industry (e.g. Dental practices)" value={ti.industry} onChange={(e) => setTi({ ...ti, industry: e.target.value })} />
                    <input className="nf-input" placeholder="Region (e.g. Calgary, AB)" value={ti.region} onChange={(e) => setTi({ ...ti, region: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 9, marginTop: 9 }}>
                    <input className="nf-input" placeholder="Audience (e.g. Practice owners, 35–60)" value={ti.audience} onChange={(e) => setTi({ ...ti, audience: e.target.value })} />
                    <select className="nf-input" value={ti.count} onChange={(e) => setTi({ ...ti, count: Number(e.target.value) })}>
                      {[3, 5, 8].map((n) => <option key={n} value={n}>{n} points</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                    <button className="btn btn-primary" style={{ padding: '7px 13px', fontSize: 11.5 }} disabled={tiBusy} onClick={tiGenerate}>
                      {tiBusy ? 'Working…' : 'Generate'}
                    </button>
                    {tiMsg && <span style={{ fontSize: 11, color: tiMsg.ok ? 'var(--grn)' : 'var(--amb)', lineHeight: 1.5 }}>{tiMsg.text}</span>}
                  </div>

                  {tiGen && (
                    <div style={{ marginTop: 13 }}>
                      <MicroLabel>Generated master research prompt — editable</MicroLabel>
                      <textarea
                        className="nf-input"
                        style={{ width: '100%', minHeight: 110, marginTop: 6, fontFamily: 'var(--mono, monospace)', fontSize: 11.5, lineHeight: 1.5 }}
                        value={tiGen.masterPrompt}
                        onChange={(e) => setTiGen({ ...tiGen, masterPrompt: e.target.value })}
                      />

                      <div style={{ marginTop: 12 }}>
                        <MicroLabel>Pain points — uncheck any you don’t want</MicroLabel>
                      </div>
                      {tiGen.painPoints.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--bg4)', borderRadius: 7, padding: '10px 12px', marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={tiKeep[i] ?? true}
                            style={{ marginTop: 3 }}
                            onChange={(e) => setTiKeep(tiKeep.map((v, j) => (j === i ? e.target.checked : v)))}
                          />
                          <div style={{ minWidth: 0, flex: 1, opacity: tiKeep[i] ? 1 : 0.45 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }}>{p.topic}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--tx2)', marginTop: 3, lineHeight: 1.5 }}>{p.painPoint}</div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 4 }}>
                              {p.keywords.join(' · ')}{p.sourceInsight ? ` — ${p.sourceInsight}` : ''}
                            </div>
                          </div>
                        </div>
                      ))}

                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" style={{ padding: '7px 13px', fontSize: 11.5 }} disabled={tiBusy} onClick={() => tiSave(true)}>
                          Save &amp; make active
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '7px 13px', fontSize: 11.5 }} disabled={tiBusy} onClick={() => tiSave(false)}>
                          Save to library
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '7px 13px', fontSize: 11.5 }} onClick={() => { setTiGen(null); setTiMsg(null); }}>
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {addOpen && (
            <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: '13px 15px', marginTop: 11 }}>
              <MicroLabel>New pain point preset — saved into the dropdown</MicroLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 9 }}>
                <input className="nf-input" placeholder="Preset name (e.g. Dental practices)" value={np.label} onChange={(e) => setNp({ ...np, label: e.target.value })} />
                <input className="nf-input" placeholder="Region (optional)" value={np.region} onChange={(e) => setNp({ ...np, region: e.target.value })} />
              </div>
              <input className="nf-input" style={{ marginTop: 9 }} placeholder="Target pain point — the underserved group to research" value={np.niche} onChange={(e) => setNp({ ...np, niche: e.target.value })} />
              <input className="nf-input" style={{ marginTop: 9 }} placeholder="Audience (optional)" value={np.aud} onChange={(e) => setNp({ ...np, aud: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <button className="btn btn-primary" style={{ padding: '7px 13px', fontSize: 11.5 }} onClick={addPreset}>Save to dropdown</button>
                <button className="btn btn-ghost" style={{ padding: '7px 13px', fontSize: 11.5 }} onClick={() => { setAddOpen(false); setNpMsg(null); }}>Cancel</button>
                {npMsg && <span style={{ fontSize: 11, color: npMsg.ok ? 'var(--grn)' : 'var(--amb)' }}>{npMsg.text}</span>}
              </div>
            </div>
          )}

          {/* pain point + audience pairs */}
          {[
            { label: 'Target pain point', value: niche, set: setNiche, known: knownPP, newV: newPP, setNew: setNewPP, saved: ppSaved, setSaved: setPpSaved, key: 'custom_pain_points', list: customPP, setList: setCustomPP, ph: '…or write a new pain point' },
            { label: 'Audience', value: audience, set: setAudience, known: knownAud, newV: newAud, setNew: setNewAud, saved: audSaved, setSaved: setAudSaved, key: 'custom_audiences', list: customAud, setList: setCustomAud, ph: '…or write a new audience' }
          ].map((f) => (
            <div key={f.label} style={{ marginTop: 13 }}>
              <MicroLabel>{f.label}</MicroLabel>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <select className="nf-input" style={{ flex: 1 }} value={f.value} onChange={(e) => { f.set(e.target.value); setSavedAt(Date.now()); }}>
                  {[...new Set([f.value, ...f.known])].filter(Boolean).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                <input className="nf-input" style={{ flex: 1 }} placeholder={f.ph} value={f.newV} onChange={(e) => { f.setNew(e.target.value); f.setSaved(false); }} />
                <button
                  className="btn btn-ghost"
                  style={{ padding: '7px 12px', fontSize: 11.5, color: f.newV && !f.saved ? 'var(--grn)' : undefined }}
                  onClick={async () => {
                    const v = f.newV.trim();
                    if (!v) return;
                    const nextList = [...new Set([...f.list, v])];
                    if (!(await put(f.key, nextList))) return;
                    f.setList(nextList);
                    f.set(v);
                    f.setSaved(true);
                    setSavedAt(Date.now());
                  }}
                >
                  {f.saved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 15 }}>
            <MicroLabel>Prompt sent to ChatGPT</MicroLabel>
            {Date.now() - promptSavedAt < 3000 && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--grn)' }}>saved ✓ · applies to next run</span>
            )}
          </div>
          <textarea
            className="nf-input mono"
            rows={12}
            style={{ marginTop: 7, fontSize: 11, lineHeight: 1.65 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={async () => {
              if (await put('master_prompt', prompt)) setPromptSavedAt(Date.now());
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
            <button
              className="btn btn-ghost"
              style={{ padding: '7px 13px', fontSize: 11.5 }}
              onClick={async () => {
                const mp = PROMPT_TEMPLATE(niche, audience);
                setPrompt(mp);
                if (await put('master_prompt', mp)) setPromptSavedAt(Date.now());
              }}
            >
              Rebuild from pain point + audience
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: '7px 13px', fontSize: 11.5 }}
              onClick={() => {
                navigator.clipboard?.writeText(prompt).catch(() => undefined);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
          </div>
        </div>

        {/* ── Automatic runner ── */}
        <div>
          <div className="card" style={{ padding: '15px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Bi-weekly scheduler</div>
                <div style={{ fontSize: 10.5, color: schedOn ? 'var(--grn)' : 'var(--tx3)', marginTop: 2 }}>
                  {schedOn ? `Every 2 weeks · next: ${nextLabel}` : 'Paused'}
                </div>
              </div>
              <Toggle on={schedOn} onClick={toggleSched} />
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--tx3)', lineHeight: 1.6, margin: '9px 0 0' }}>
              {schedOn
                ? 'Auto-runner posts a signed webhook on schedule — runs start with no manual trigger, gated by max concurrency.'
                : 'Auto-runner paused. Use "Run pipeline now" or the header\'s Simulate Karbon trigger.'}
            </p>
            <div className="codebox" style={{ marginTop: 10 }}>POST /api/webhooks/karbon · signed HMAC-SHA256 · idempotency-keyed</div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 11 }} onClick={runNow}>
              Run pipeline now
            </button>
            <p style={{ fontSize: 10, color: 'var(--tx4)', margin: '9px 0 0', lineHeight: 1.55 }}>
              Each trigger queues exactly 3 content sets (blog + lead magnet + distribution payloads).
            </p>
          </div>

          <div className="card" style={{ padding: '15px 18px', marginTop: 14 }}>
            <MicroLabel>Pipeline order</MicroLabel>
            <div style={{ fontSize: 11.5, lineHeight: 1.9, marginTop: 7, color: 'var(--tx1)' }}>
              Research (pain point) → Generate → Uniqueness Registry → Auto-SEO loop →{' '}
              <span style={{ color: 'var(--vio)', fontWeight: 600 }}>{ACCT_STATUS}</span> → Deploy → Distribution review → Publish
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        {/* ── research registry feed ── */}
        <div className="card" style={{ padding: '15px 18px' }}>
          <MicroLabel>Extracted pain points · research registry</MicroLabel>
          <p style={{ fontSize: 10.5, color: 'var(--tx3)', margin: '6px 0 0' }}>Levenshtein guard rejects anything &gt; 0.7 similar to prior research.</p>
          <div style={{ marginTop: 6 }}>
            {feed.map((e, i) => (
              <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>{e.title}</div>
                <div className="mono" style={{ display: 'flex', gap: 10, fontSize: 9.5, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: e.status === 'unique' ? 'var(--grn)' : 'var(--red)' }}>
                    {e.status === 'unique' ? 'unique — saved' : 'duplicate — skipped'}
                  </span>
                  <span style={{ color: e.lev != null && e.lev >= 0.7 ? 'var(--red)' : 'var(--tx3)' }}>Levenshtein {e.lev ?? '—'}</span>
                  <span style={{ color: 'var(--tx3)' }}>{e.run}</span>
                  <span style={{ color: 'var(--tx4)' }}>{fmtAgo(e.t)}</span>
                </div>
              </div>
            ))}
            {feed.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--tx3)', padding: '12px 0' }}>No research yet — trigger a run.</div>}
          </div>
        </div>

        {/* ── form capture → ActiveCampaign ── */}
        <div className="card" style={{ padding: '15px 18px' }}>
          <MicroLabel>Form capture → ActiveCampaign</MicroLabel>
          <p style={{ fontSize: 10.5, color: 'var(--tx3)', margin: '6px 0 0', lineHeight: 1.55 }}>
            Lead-magnet forms map to contact-level custom fields only — never deal or work-item fields.
          </p>
          <div style={{ marginTop: 6 }}>
            {leads.map((l, i) => (
              <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{l.name}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{l.email}</span>
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: l.synced ? 'var(--grn)' : 'var(--amb)' }}>
                    {l.synced ? 'synced ✓' : 'syncing…'}
                  </span>
                </div>
                <div className="mono" style={{ display: 'flex', gap: 6, fontSize: 9, marginTop: 5, flexWrap: 'wrap' }}>
                  <span style={{ background: 'var(--bg3)', border: '1px solid var(--line4)', borderRadius: 99, padding: '2px 7px', color: 'var(--tx2)' }}>
                    cf_pain_point: {l.painField}
                  </span>
                  <span style={{ background: 'var(--bg3)', border: '1px solid var(--line4)', borderRadius: 99, padding: '2px 7px', color: 'var(--tx2)' }}>
                    cf_lead_source: {l.source}
                  </span>
                  <span style={{ color: 'var(--tx4)', padding: '2px 0' }}>{fmtAgo(l.t)}</span>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10, color: 'var(--tx4)', margin: '10px 0 0', lineHeight: 1.55 }}>
            After capture, a 3-email nurture sequence is drafted (GPT-4o) and saved as ActiveCampaign drafts.
          </p>
        </div>
      </div>

      {/* ── preset manager ── */}
      <div className="card" style={{ padding: '15px 18px', marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MicroLabel>Pain point presets</MicroLabel>
          <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{presets.length} presets</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--tx2)', margin: '7px 0 0', lineHeight: 1.6, maxWidth: 720 }}>
          Each preset bundles a target pain point, audience and region and drives the auto-runner's topic pool. Pick one from the dropdown above; built-in presets are locked, custom ones can be deleted.
        </p>
        <div style={{ marginTop: 6 }}>
          {presets.map((p) => (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line2)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.label}</span>
                  {activeKey === p.key && (
                    <span className="pill" style={{ color: 'var(--grn)', background: 'rgba(19,122,91,.11)' }}>active</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--tx3)', marginTop: 3 }}>
                  {p.niche} · {p.audience} · {p.region || '—'}
                </div>
              </div>
              {p.builtin ? (
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--tx4)', border: '1px solid var(--line4)', borderRadius: 99, padding: '2px 8px' }}>
                  built-in
                </span>
              ) : (
                <button style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => deletePreset(p.key)}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--tx4)', margin: '10px 0 0' }}>
          Add a new preset with + New preset beside the dropdown at the top of this page — it saves straight into the dropdown and becomes the active preset.
        </p>
      </div>
    </div>
  );
}
