/** Parse an env value to an int and clamp it to [lo, hi]; falls back on NaN. */
export function clampInt(raw: string | number | undefined, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
