import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Run, AuditRow, STAGES, STAGE_COLOR } from '../lib/types';
import { StatusPill, StageBadge } from './ui';
import { fmtClock, fmtDur } from '../lib/format';

// Audit-trail / job-log modal (DESIGN_SPEC §9.1): 12 job cards + full audit
// list. Opened by clicking any run row, archive card, or `Run log`.

const HUMAN_SET = /^[a-z]+\.[a-z]+$/; // handles like j.mercer

export default function AuditModal({ run, onClose }: { run: Run; onClose: () => void }) {
  const nav = useNavigate();
  const [audit, setAudit] = useState<AuditRow[]>([]);

  useEffect(() => {
    api.get<{ audit: AuditRow[] }>(`/api/runs/${run.id}/audit`).then((r) => setAudit(r.audit));
  }, [run.id]);

  // Clock times derive from createdAt + cumulative stage ms (prototype behavior).
  let tCur = run.createdAt;
  const jobs = STAGES.map((sg, i) => {
    const s = run.stages[i] ?? { status: 'pending', attempts: 1, ms: 0, note: '' };
    const started = s.status !== 'pending';
    const live = s.status === 'active' || s.status === 'retry' || s.status === 'gate';
    const startT = tCur;
    const jdur = s.ms || (live ? Date.now() - tCur : 0);
    const endT = startT + jdur;
    if (started) tCur = endT;
    return {
      num: String(i + 1).padStart(2, '0'),
      label: sg.label,
      queue: sg.queue,
      jobId: `jb_${run.runNo}_${String(i + 1).padStart(2, '0')}`,
      status: s.status,
      dot: s.status === 'pending' ? 'var(--dot)' : STAGE_COLOR[s.status],
      live,
      start: started ? fmtClock(startT) : '—',
      end: started && !live ? fmtClock(endT) : live ? 'running' : '—',
      dur: started ? fmtDur(jdur) || '<1s' : 'queued',
      attempts: `${s.attempts} attempt${s.attempts > 1 ? 's' : ''}`,
      err: s.err ?? '',
      note: s.note ?? ''
    };
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,11,9,.48)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 780, maxHeight: '86vh', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)', boxShadow: '0 24px 60px rgba(15,13,10,.4)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 20px', borderBottom: '1px solid var(--line2)' }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{run.wf}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{run.karbon}</span>
          <StatusPill status={run.status} />
          <span className="microlabel" style={{ marginLeft: 'auto' }}>audit trail · bullmq jobs</span>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line5)', background: 'transparent', color: 'var(--tx2)', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflow: 'auto', padding: '14px 20px' }}>
          {jobs.map((j) => (
            <div key={j.num} style={{ border: '1px solid var(--line3)', borderRadius: 8, padding: '10px 13px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--tx4)' }}>{j.num}</span>
                <span className={j.live ? 'nf-pulse' : undefined} style={{ width: 8, height: 8, borderRadius: '50%', background: j.dot, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{j.label}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{j.queue}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--tx4)', marginLeft: 'auto' }}>{j.jobId}</span>
                <StageBadge status={j.status} width={88} />
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 6, marginLeft: 27, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>start {j.start}</span>
                <span>end {j.end}</span>
                <span>{j.dur}</span>
                <span>{j.attempts}</span>
              </div>
              {j.err && (
                <pre
                  className="mono"
                  style={{ background: 'var(--redT)', border: '1px solid var(--redL)', borderRadius: 7, padding: '9px 11px', fontSize: 10.5, color: 'var(--red)', whiteSpace: 'pre-wrap', margin: '8px 0 0 27px', lineHeight: 1.6 }}
                >
                  {j.err}
                </pre>
              )}
              {j.note && !j.err && (
                <div style={{ fontSize: 11, color: 'var(--tx2)', margin: '7px 0 0 27px', lineHeight: 1.55 }}>{j.note}</div>
              )}
            </div>
          ))}

          <div className="microlabel" style={{ margin: '14px 0 8px' }}>Audit log</div>
          {[...audit].reverse().map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--line2)', alignItems: 'baseline' }}>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--tx4)', width: 52, flexShrink: 0 }}>{fmtClock(a.t)}</span>
              <span
                className="mono"
                style={{ fontSize: 9.5, width: 56, flexShrink: 0, color: HUMAN_SET.test(a.who) ? 'var(--vio)' : a.who === 'api' ? 'var(--grn)' : 'var(--tx3)' }}
              >
                {a.who}
              </span>
              <span style={{ fontSize: 11, color: 'var(--tx1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.msg}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--line2)' }}>
          <span style={{ fontSize: 10, color: 'var(--tx4)' }}>
            Timestamps from BullMQ job lifecycle events · error bodies verbatim from adapter responses
          </span>
          <button
            className="mono"
            onClick={() => {
              onClose();
              nav(`/runs/${run.id}`);
            }}
            style={{ background: 'transparent', border: 'none', color: 'var(--grn)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Open full run →
          </button>
        </div>
      </div>
    </div>
  );
}
