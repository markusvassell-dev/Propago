import { CSSProperties, ReactNode } from 'react';
import { StageEntry, StageStatus, STAGES, STAGE_COLOR, STATUS_META, UiStatus, STAGE_TINT, STAGE_LABEL } from '../lib/types';

// Small shared primitives, all reading only var(--*) tokens (spec §11).

export function MicroLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="microlabel" style={style}>{children}</div>;
}

export function StatusPill({ status, labelOverride }: { status: UiStatus; labelOverride?: string }) {
  const m = STATUS_META[status];
  return (
    <span className="pill" style={{ color: m.c, background: m.bg }}>
      {labelOverride ?? m.label}
    </span>
  );
}

export function StageBadge({ status, width = 96 }: { status: StageStatus; width?: number }) {
  return (
    <span
      className="pill"
      style={{
        color: status === 'pending' ? 'var(--tx3)' : STAGE_COLOR[status],
        background: STAGE_TINT[status],
        width,
        textAlign: 'center',
        boxSizing: 'border-box'
      }}
    >
      {STAGE_LABEL[status]}
    </span>
  );
}

const live = (s: StageStatus) => s === 'active' || s === 'retry' || s === 'gate';

/** §5.2 ③ / §6 — the 12-segment pipeline strip. */
export function StageStrip({
  stages,
  withLabels = false,
  segW = 8,
  segH = 6
}: {
  stages: StageEntry[];
  withLabels?: boolean;
  segW?: number;
  segH?: number;
}) {
  return (
    <div style={{ display: 'flex', gap: withLabels ? 6 : 3 }}>
      {STAGES.map((sg, i) => {
        const st = stages[i]?.status ?? 'pending';
        const seg = (
          <div
            className={live(st) ? 'nf-pulse' : undefined}
            style={{
              width: withLabels ? '100%' : segW,
              height: segH,
              borderRadius: 2,
              background: st === 'pending' ? 'var(--seg)' : STAGE_COLOR[st]
            }}
          />
        );
        if (!withLabels) return <div key={sg.key}>{seg}</div>;
        return (
          <div key={sg.key} style={{ flex: 1 }}>
            {seg}
            <div
              className="mono"
              style={{ fontSize: 8.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--tx3)', marginTop: 4, textAlign: 'center' }}
            >
              {sg.strip}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** §8.8-style 38×22 toggle. */
export function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 38,
        height: 22,
        borderRadius: 99,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? 'var(--grn)' : 'var(--line5)',
        position: 'relative',
        transition: 'background .15s ease',
        flexShrink: 0
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 19 : 3,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.25)',
          transition: 'left .15s ease'
        }}
      />
    </button>
  );
}

export function KeywordChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        background: 'var(--bg3)',
        border: '1px solid var(--line4)',
        borderRadius: 99,
        padding: '3px 9px',
        color: 'var(--tx2)'
      }}
    >
      {children}
    </span>
  );
}

/** §7.4 — 5px SEO sub-score bar. */
export function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'var(--grn)' : value >= 60 ? 'var(--amb)' : 'var(--red)';
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tx2)' }}>
        <span>{label}</span>
        <span className="mono">{value}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--line2)', marginTop: 4 }}>
        <div style={{ height: 5, borderRadius: 3, width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

export function Avatar({ initials, size = 24 }: { initials: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--vio)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        flexShrink: 0
      }}
    >
      {initials}
    </div>
  );
}
