import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Run, AuditRow, STAGES, STAGE_COLOR } from '../lib/types';
import { StatusPill, StageStrip, StageBadge, KeywordChip, MicroLabel } from '../components/ui';
import { fmtAgo, fmtDur, fmtClock, cap } from '../lib/format';
import { useApp } from '../context/AppContext';

// Run detail page (DESIGN_SPEC §6): header card + labeled 12-segment strip,
// saga stage list with Retry now, artifacts card (6 fixed rows), audit trail.

const HUMAN = /^[a-z]+\.[a-z]+$/;

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useApp();
  const [run, setRun] = useState<Run | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [r, a] = await Promise.all([
        api.get<{ run: Run }>(`/api/runs/${id}`),
        api.get<{ audit: AuditRow[] }>(`/api/runs/${id}/audit`)
      ]);
      setRun(r.run);
      setAudit(a.audit);
    } catch {
      /* poll retries */
    }
  }, [id]);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 2000);
    return () => window.clearInterval(iv);
  }, [load]);

  if (!run) return <div style={{ padding: 40, fontSize: 12.5, color: 'var(--tx3)' }}>Loading run…</div>;

  const retryNow = async () => {
    try {
      const r = await api.post<{ stage: string; attempt: number }>(`/api/runs/${run.id}/retry`);
      showToast(`Manual retry — ${r.stage} attempt ${r.attempt}`);
      await load();
    } catch {
      showToast(`${run.wf} is no longer parked — nothing retried`);
    }
  };

  const art = run.artifacts;
  const artifactRows: Array<[string, string | null, string]> = [
    ['Blog post (WordPress)', art.blogUrl, '— pending deploy'],
    ['Lead magnet PDF', art.magnetUrl, '— pending deploy'],
    ['Meta ads (sandbox)', art.adId, '— pending'],
    ['ActiveCampaign', art.campaignId, '— pending'],
    ['Social posts', art.social, '— pending'],
    ['Karbon timeline note', art.karbonNote, '— on completion / terminal failure']
  ];

  return (
    <div>
      <Link
        to="/runs"
        className="mono"
        style={{ fontSize: 11, color: 'var(--tx3)', textDecoration: 'none' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--grn)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--tx3)')}
      >
        ← all runs
      </Link>

      {/* header card */}
      <div className="card" style={{ marginTop: 10, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{run.wf}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{run.karbon}</span>
          <StatusPill status={run.status} />
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tx3)' }}>created {fmtAgo(run.createdAt)}</span>
        </div>
        <div className="disp" style={{ fontSize: 19, fontWeight: 600, marginTop: 9 }}>{cap(run.topic)}</div>
        <div style={{ fontSize: 11.5, color: 'var(--tx2)', marginTop: 3 }}>
          {run.client} · tone: {run.tone} · {run.revisions === 0 ? 'no revisions' : `${run.revisions} revision${run.revisions > 1 ? 's' : ''}`}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {run.keywords.map((k) => (
            <KeywordChip key={k}>{k}</KeywordChip>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <StageStrip stages={run.stages} withLabels />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 336px', gap: 14, marginTop: 14 }}>
        {/* saga stages */}
        <div className="card" style={{ padding: '14px 18px' }}>
          <MicroLabel>Saga stages · durable via BullMQ + Postgres</MicroLabel>
          <div style={{ marginTop: 8 }}>
            {STAGES.map((sg, i) => {
              const s = run.stages[i];
              const live = s.status === 'active' || s.status === 'retry' || s.status === 'gate';
              const isFailedStage = s.status === 'failed' && run.status === 'failed';
              return (
                <div key={sg.key} style={{ padding: '9px 0', borderBottom: '1px solid var(--line2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--tx4)', width: 18 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={live ? 'nf-pulse' : undefined}
                      style={{ width: 8, height: 8, borderRadius: '50%', background: s.status === 'pending' ? 'var(--dot)' : STAGE_COLOR[s.status], flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{sg.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx3)', marginLeft: 8 }}>{sg.sys}</span>
                    </div>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>
                      {s.status !== 'pending' ? `${s.attempts} attempt${s.attempts > 1 ? 's' : ''}${s.ms ? ` · ${fmtDur(s.ms)}` : ''}` : ''}
                    </span>
                    {isFailedStage && (
                      <button className="btn btn-redsolid" style={{ padding: '5px 11px', fontSize: 11 }} onClick={retryNow}>
                        Retry now
                      </button>
                    )}
                    <StageBadge status={s.status} />
                  </div>
                  {(s.note || live) && (
                    <div
                      className="mono"
                      style={{ background: 'var(--bg4)', borderRadius: 6, padding: '7px 10px', fontSize: 10.5, color: 'var(--tx2)', margin: '7px 0 0 36px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
                    >
                      {s.note || 'In progress…'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* right rail */}
        <div>
          <div className="card" style={{ padding: '14px 17px' }}>
            <MicroLabel>Artifacts</MicroLabel>
            {artifactRows.map(([label, val, placeholder]) => (
              <div key={label} style={{ marginTop: 11 }}>
                <div style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{label}</div>
                <div className="mono" style={{ fontSize: 10.5, marginTop: 2, color: val ? 'var(--grn)' : 'var(--tx4)', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {val ?? placeholder}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: '14px 17px', marginTop: 14 }}>
            <MicroLabel>Audit trail</MicroLabel>
            <div style={{ maxHeight: 340, overflow: 'auto', marginTop: 8 }}>
              {[...audit].reverse().map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line2)', alignItems: 'baseline' }}>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--tx4)', width: 52, flexShrink: 0 }}>{fmtClock(a.t)}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 9.5, width: 56, flexShrink: 0, color: HUMAN.test(a.who) ? 'var(--vio)' : a.who === 'api' ? 'var(--grn)' : 'var(--tx3)' }}
                  >
                    {a.who}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--tx1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
