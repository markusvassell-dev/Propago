// Formatting helpers mirroring the prototype's fmtAgo / fmtDur / fmtClock / slugOf.

export function fmtAgo(t: number): string {
  const d = Math.max(0, Date.now() - t);
  if (d < 50_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${(d / 3_600_000).toFixed(1).replace(/\.0$/, '')}h ago`;
}

export function fmtDur(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function fmtClock(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Spec §2 slug rule: lowercase, strip non [a-z0-9 ], first 5 words joined with '-'. */
export function slugOf(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 5).join('-');
}
export const slug3Of = (topic: string): string => slugOf(topic).split('-').slice(0, 3).join('-');

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
