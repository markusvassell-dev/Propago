import { createHash } from 'crypto';
import { query, audit } from '../db/pool';
import { levenshteinSimilarity, tfidfCosineMax, sim2 } from '../utils/similarity';

// Uniqueness Registry (DESIGN_SPEC §2.1 rules 2–3, §13.2).
//   Assets (blog/linkedin/facebook/instagram/magnet): SHA-256 exact match OR
//   TF-IDF cosine ≥ 0.82 vs the registry corpus ⇒ duplicate-blocked ⇒ regenerate.
//   Pain points: Levenshtein similarity > 0.7 vs prior research ⇒ duplicate ⇒ re-extract.

export const COSINE_BLOCK = 0.82;
export const LEV_BLOCK = 0.7;

export type AssetType = 'blog' | 'linkedin' | 'facebook' | 'instagram' | 'magnet';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

async function insertRow(row: {
  runId: string | null;
  type: AssetType | 'painpoint';
  title: string;
  body: string;
  sha256: string;
  cosine?: number | null;
  lev?: number | null;
  status: 'unique' | 'regenerated' | 'duplicate-blocked';
  method: string;
}): Promise<void> {
  await query(
    `INSERT INTO content_registry (workflow_run_id, asset_type, title, body, sha256, tfidf_cosine, levenshtein, status, method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [row.runId, row.type, row.title, row.body, row.sha256, row.cosine ?? null, row.lev ?? null, row.status, row.method]
  );
}

/**
 * Fingerprint one generated asset against the registry.
 * Returns { blocked, cosine }. Inserts a registry row either way:
 * blocked ⇒ 'duplicate-blocked' row; unique ⇒ 'unique' (or 'regenerated' when this
 * is a retry after an earlier block, so the registry shows the loop happened).
 */
export async function checkAndRegisterAsset(
  runId: string,
  type: AssetType,
  title: string,
  body: string,
  opts: { afterBlock?: boolean } = {}
): Promise<{ blocked: boolean; cosine: number }> {
  const hash = sha256(body);
  // The 3 content sets fanned out from ONE trigger are deliberate same-topic
  // variants — the registry guards against repeats vs PRIOR content, so
  // sibling runs (same karbon_work_id) are excluded from the comparison corpus.
  const { rows: exact } = await query(
    `SELECT cr.id FROM content_registry cr
      LEFT JOIN workflow_runs wr ON wr.id = cr.workflow_run_id
      LEFT JOIN workflow_runs me ON me.id = $2
      WHERE cr.sha256 = $1 AND cr.status <> 'duplicate-blocked'
        AND (wr.karbon_work_id IS NULL OR me.karbon_work_id IS NULL OR wr.karbon_work_id <> me.karbon_work_id)
      LIMIT 1`,
    [hash, runId]
  );
  const { rows: corpusRows } = await query<{ body: string }>(
    `SELECT cr.body FROM content_registry cr
      LEFT JOIN workflow_runs wr ON wr.id = cr.workflow_run_id
      LEFT JOIN workflow_runs me ON me.id = $2
      WHERE cr.asset_type = $1 AND cr.status <> 'duplicate-blocked' AND cr.body <> ''
        AND cr.workflow_run_id IS DISTINCT FROM $2
        AND (wr.karbon_work_id IS NULL OR me.karbon_work_id IS NULL OR wr.karbon_work_id <> me.karbon_work_id)
      ORDER BY cr.created_at DESC LIMIT 200`,
    [type, runId]
  );
  const { max } = tfidfCosineMax(body, corpusRows.map((r) => r.body));
  const cosine = sim2(max);
  const blocked = exact.length > 0 || cosine >= COSINE_BLOCK;

  await insertRow({
    runId,
    type,
    title: blocked ? `Draft rejected — near-duplicate` : title,
    body,
    sha256: hash,
    cosine: exact.length > 0 ? 1 : cosine,
    status: blocked ? 'duplicate-blocked' : opts.afterBlock ? 'regenerated' : 'unique',
    method: 'SHA-256 + TF-IDF cosine'
  });
  return { blocked, cosine: exact.length > 0 ? 1 : cosine };
}

/**
 * Levenshtein research guard. Returns { duplicate, lev } where lev is the
 * similarity vs the nearest prior pain point. Records the registry row.
 */
export async function checkAndRegisterPainPoint(
  runId: string,
  painPoint: string
): Promise<{ duplicate: boolean; lev: number }> {
  // Sibling runs (same trigger) intentionally share a pain point — compare
  // against prior triggers' research only.
  const { rows } = await query<{ title: string }>(
    `SELECT cr.title FROM content_registry cr
      LEFT JOIN workflow_runs wr ON wr.id = cr.workflow_run_id
      LEFT JOIN workflow_runs me ON me.id = $1
      WHERE cr.asset_type = 'painpoint' AND cr.status <> 'duplicate-blocked'
        AND cr.workflow_run_id IS DISTINCT FROM $1
        AND (wr.karbon_work_id IS NULL OR me.karbon_work_id IS NULL OR wr.karbon_work_id <> me.karbon_work_id)
      ORDER BY cr.created_at DESC LIMIT 200`,
    [runId]
  );
  let lev = 0;
  for (const r of rows) lev = Math.max(lev, levenshteinSimilarity(painPoint, r.title));
  lev = sim2(lev);
  const duplicate = lev > LEV_BLOCK;
  await insertRow({
    runId,
    type: 'painpoint',
    title: duplicate ? `Rejected: too similar to prior pain point` : painPoint,
    body: painPoint,
    sha256: sha256(painPoint),
    lev,
    status: duplicate ? 'duplicate-blocked' : 'unique',
    method: 'Levenshtein research guard'
  });
  if (duplicate) {
    await audit(runId, 'system', 'registry.painpoint_blocked', { lev, painPoint });
  }
  return { duplicate, lev };
}

export interface RegistryStats {
  total: number;
  unique: number;
  regenerated: number;
  blocked: number;
}

export async function registryStats(): Promise<RegistryStats> {
  const { rows } = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n FROM content_registry GROUP BY status`
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = parseInt(r.n, 10);
  const uniq = by['unique'] ?? 0;
  const regen = by['regenerated'] ?? 0;
  const blocked = by['duplicate-blocked'] ?? 0;
  return { total: uniq + regen + blocked, unique: uniq, regenerated: regen, blocked };
}
