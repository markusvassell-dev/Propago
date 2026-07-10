// Uniqueness math (DESIGN_SPEC §2.1 / §13.2). Pure functions, no deps.
//   - Levenshtein similarity guards the research registry (> 0.7 = duplicate).
//   - TF-IDF cosine guards generated assets (≥ 0.82 = duplicate-blocked).

/** Normalized Levenshtein similarity in [0,1]: 1 − distance / max(len). */
export function levenshteinSimilarity(a: string, b: string): number {
  const s = a.toLowerCase().trim();
  const t = b.toLowerCase().trim();
  if (!s.length && !t.length) return 1;
  if (!s.length || !t.length) return 0;
  let prev = new Array(t.length + 1).fill(0).map((_, i) => i);
  let cur = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  const dist = prev[t.length];
  return 1 - dist / Math.max(s.length, t.length);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/**
 * Max TF-IDF cosine similarity of `candidate` against each doc in `corpus`.
 * IDF is computed over corpus + candidate. Returns 0 for an empty corpus.
 */
export function tfidfCosineMax(candidate: string, corpus: string[]): { max: number; nearestIndex: number } {
  if (!corpus.length) return { max: 0, nearestIndex: -1 };
  const docs = corpus.map(tokenize);
  const cand = tokenize(candidate);
  const all = [...docs, cand];
  const df = new Map<string, number>();
  for (const doc of all) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const N = all.length;
  const idf = (term: string) => Math.log(1 + N / (df.get(term) ?? 1));
  const vec = (tokens: string[]) => {
    const tf = termFreq(tokens);
    const v = new Map<string, number>();
    for (const [term, f] of tf) v.set(term, (f / tokens.length) * idf(term));
    return v;
  };
  const cv = vec(cand);
  const cNorm = Math.sqrt([...cv.values()].reduce((s, x) => s + x * x, 0));
  let max = 0;
  let nearestIndex = -1;
  docs.forEach((doc, i) => {
    if (!doc.length) return;
    const dv = vec(doc);
    let dot = 0;
    for (const [term, x] of cv) {
      const y = dv.get(term);
      if (y) dot += x * y;
    }
    const dNorm = Math.sqrt([...dv.values()].reduce((s, x) => s + x * x, 0));
    const cos = cNorm && dNorm ? dot / (cNorm * dNorm) : 0;
    if (cos > max) {
      max = cos;
      nearestIndex = i;
    }
  });
  return { max: +max.toFixed(2), nearestIndex };
}

/** Round to 2dp like the dashboard renders (`Levenshtein 0.38`, `TF-IDF cosine 0.16`). */
export const sim2 = (n: number): number => +n.toFixed(2);
