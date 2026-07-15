import { query } from '../db/pool';
import { env } from '../config/env';
import { KarbonTrigger } from '../adapters/types';
import { createRunFromTrigger, ConflictError } from '../saga/orchestrator';
import { getWorkItem, setWorkItemStatus, postTimelineNote } from './karbonClient';

// Native Karbon Work-webhook processing (WebhookType="Work").
//
// Flow (see webhook.routes.ts → karbon-inbound worker):
//   1. Read ResourcePermaKey from the webhook body.
//   2. Fetch the full Work Item (GET /WorkItems/{key}).
//   3. Decide if it is at the ACTIVATION status (PROPAGO_TRIGGER_STATUS),
//      inspecting PrimaryStatus / SecondaryStatus / WorkStatus.
//   4. Idempotency: one Propago batch per (work item + activation status +
//      status version) — duplicates are ignored.
//   5. Trigger a Propago run carrying the work-item context.
//   6. On batch completion, write the completion status back to Karbon ONCE.
//
// Loop prevention: we only trigger on the activation status. Writing the
// completion status back fires another Work webhook, but that event's status is
// PROPAGO_COMPLETE_STATUS (not the activation status), so it is a no-op here.

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Pull the work-item resource key out of Karbon's webhook body (several shapes). */
export function extractResourcePermaKey(payload: unknown): string {
  const p = asRecord(payload);
  const candidates = [
    p.ResourcePermaKey,
    p.WorkItemKey,
    asRecord(p.Resource).PermaKey,
    asRecord(p.Resource).WorkItemKey,
    asRecord(p.Data).ResourcePermaKey,
    asRecord(p.Data).WorkItemKey
  ];
  for (const c of candidates) {
    const s = str(c).trim();
    if (s) return s;
  }
  return '';
}

export interface WorkItemStatuses {
  primary: string;
  secondary: string;
  work: string;
}

/** Read the status fields Karbon may expose (not just the legacy WorkStatus). */
export function extractStatuses(wi: Record<string, unknown>): WorkItemStatuses {
  return {
    primary: str(wi.PrimaryStatus ?? asRecord(wi.PrimaryStatus).Name),
    secondary: str(wi.SecondaryStatus ?? asRecord(wi.SecondaryStatus).Name),
    work: str(wi.WorkStatus ?? asRecord(wi.WorkStatus).Name)
  };
}

/** Case-insensitive match of `target` against any populated status field. */
export function matchesStatus(wi: Record<string, unknown>, target: string): boolean {
  if (!target) return false;
  const t = target.trim().toLowerCase();
  return Object.values(extractStatuses(wi)).some((s) => s.trim().toLowerCase() === t);
}

/** A stable-ish version stamp so re-fires at the same status dedupe, but a genuine
 *  new transition (later activity) is treated as a fresh, triggerable event. */
export function statusVersion(wi: Record<string, unknown>): string {
  const v = wi.LastActivityDate ?? wi.LastModifiedDateTime ?? wi.ModifiedDate ?? wi.Version;
  return str(v).trim() || 'v0';
}

/** Build the Propago trigger from the work item, falling back to webhook fields. */
export function buildTrigger(
  wi: Record<string, unknown>,
  payload: Record<string, unknown>,
  permaKey: string,
  activationStatus: string
): KarbonTrigger {
  const title = str(wi.Title ?? wi.WorkTitle ?? payload.Title).trim() || `Karbon work item ${permaKey}`;
  const client = str(wi.ClientName ?? wi.RelationshipName ?? wi.PrimaryContactName ?? payload.ClientName).trim();
  return {
    workItemId: permaKey,
    stageId: activationStatus, // batch is keyed by work item + activation status
    clientName: client,
    topic: title,
    keywords: [],
    tone: 'Authoritative, plainspoken'
  };
}

export interface ProcessResult {
  triggered: boolean;
  reason: 'triggered' | 'status_no_match' | 'duplicate' | 'already_running';
  permaKey: string;
  currentStatus?: WorkItemStatuses;
  runIds?: string[];
}

/**
 * The full inbound flow for one Work webhook. Pure of Express — driven by the
 * karbon-inbound worker (and the local test route). Never throws for an
 * expected outcome (no match / duplicate); it returns a typed reason instead.
 */
export async function processWorkEvent(input: { permaKey: string; payload?: unknown }): Promise<ProcessResult> {
  const { permaKey } = input;
  const payload = asRecord(input.payload);

  // 2. Fetch the full work item (stub mode returns null → use webhook fields).
  // A 4xx from Karbon won't get better on retry — fall back to the webhook
  // payload (loudly) so a wrong key/permission shows up in the decision logs
  // instead of dying silently. Network/5xx errors throw so BullMQ retries.
  let fetched: Record<string, unknown> | null = null;
  try {
    fetched = await getWorkItem(permaKey);
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status && status >= 400 && status < 500) {
      console.warn(`[karbon-work] ${permaKey} — work-item fetch got HTTP ${status}; falling back to webhook payload fields`);
    } else {
      throw err; // transient — let the queue retry with backoff
    }
  }
  const wi = fetched ?? payload;
  const statuses = extractStatuses(wi);
  console.info(`[karbon-work] ${permaKey} — statuses primary="${statuses.primary}" secondary="${statuses.secondary}" work="${statuses.work}"`);

  // 5. Activation check. Only the configured trigger status arms a run.
  if (!matchesStatus(wi, env.karbon.triggerStatus)) {
    console.info(`[karbon-work] ${permaKey} — not at activation status "${env.karbon.triggerStatus}"; ignoring`);
    return { triggered: false, reason: 'status_no_match', permaKey, currentStatus: statuses };
  }

  // 6. Idempotency — one event row per (work item + activation status + version).
  const version = statusVersion(wi);
  const { rows: evRows } = await query<{ id: string }>(
    `INSERT INTO karbon_work_events (work_item_key, activation_status, status_version)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT uq_karbon_work_event DO NOTHING
       RETURNING id`,
    [permaKey, env.karbon.triggerStatus, version]
  );
  if (evRows.length === 0) {
    console.info(`[karbon-work] ${permaKey} — duplicate activation (status="${env.karbon.triggerStatus}" version="${version}"); suppressed`);
    return { triggered: false, reason: 'duplicate', permaKey, currentStatus: statuses };
  }
  const eventId = evRows[0].id;

  // 7. Trigger Propago.
  const trigger = buildTrigger(wi, payload, permaKey, env.karbon.triggerStatus);
  try {
    const { runIds } = await createRunFromTrigger(trigger);
    await query(
      `UPDATE karbon_work_events SET state = 'running', run_ids = $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(runIds), eventId]
    );
    console.info(`[karbon-work] ${permaKey} — triggered Propago (${runIds.length} runs) for "${trigger.topic}"`);
    return { triggered: true, reason: 'triggered', permaKey, currentStatus: statuses, runIds };
  } catch (err) {
    if (err instanceof ConflictError) {
      // A run for this work item + activation status already exists (older
      // version row cleaned up, or a race). Not an error — just don't re-run.
      console.info(`[karbon-work] ${permaKey} — Propago already triggered for this activation; suppressed`);
      await query(`UPDATE karbon_work_events SET state = 'running', updated_at = now() WHERE id = $1`, [eventId]);
      return { triggered: false, reason: 'already_running', permaKey, currentStatus: statuses };
    }
    // Real failure: release the event row so a Karbon retry can succeed later.
    await query(`DELETE FROM karbon_work_events WHERE id = $1`, [eventId]);
    throw err;
  }
}

const TERMINAL = ['complete', 'failed', 'rejected'];

/**
 * Called when a run reaches a terminal state. When every run in the batch
 * (same work item + activation status) has settled, write the completion (or
 * error) status back to Karbon EXACTLY once, guarded by completed_notified_at.
 * A failed batch never gets marked complete.
 */
export async function onRunSettledForKarbon(runId: string): Promise<void> {
  const { rows: runRows } = await query<{ karbon_work_id: string; karbon_stage_id: string }>(
    `SELECT karbon_work_id, karbon_stage_id FROM workflow_runs WHERE id = $1`,
    [runId]
  );
  if (runRows.length === 0) return;
  const { karbon_work_id: workKey, karbon_stage_id: activation } = runRows[0];

  const { rows: siblings } = await query<{ status: string }>(
    `SELECT status FROM workflow_runs WHERE karbon_work_id = $1 AND karbon_stage_id = $2`,
    [workKey, activation]
  );
  const inFlight = siblings.some((r) => !TERMINAL.includes(r.status));
  if (inFlight) return; // batch not settled yet

  const completeCount = siblings.filter((r) => r.status === 'complete').length;
  const failedCount = siblings.filter((r) => r.status === 'failed').length;

  // Only act on a batch that came in through the native Work webhook.
  const { rows: evRows } = await query<{ id: string }>(
    `SELECT id FROM karbon_work_events
       WHERE work_item_key = $1 AND activation_status = $2
       ORDER BY created_at DESC LIMIT 1`,
    [workKey, activation]
  );
  if (evRows.length === 0) return;
  const eventId = evRows[0].id;

  const succeeded = completeCount > 0;
  const claim = await query(
    `UPDATE karbon_work_events
        SET completed_notified_at = now(), state = $2, updated_at = now()
      WHERE id = $1 AND completed_notified_at IS NULL
      RETURNING id`,
    [eventId, succeeded ? 'complete' : 'failed']
  );
  if ((claim.rowCount ?? 0) === 0) return; // already written back

  if (succeeded) {
    const ok = await setWorkItemStatus(workKey, env.karbon.completeStatus);
    console.info(`[karbon-work] ${workKey} — batch complete (${completeCount}/${siblings.length}); status→"${env.karbon.completeStatus}" ${ok ? 'written to Karbon' : 'NOT written (see error above; timeline note still posts)'}`);
    await postTimelineNote(
      workKey,
      'Propago complete',
      `<p><strong>Propago finished</strong> — ${completeCount} of ${siblings.length} content set(s) published. Status set to “${env.karbon.completeStatus}”.</p>`
    ).catch((e) => console.warn('[karbon-work] completion note failed (non-fatal):', str(e)));
  } else if (env.karbon.errorStatus) {
    // Do NOT silently mark complete on failure — set the configured error status.
    const ok = await setWorkItemStatus(workKey, env.karbon.errorStatus);
    console.warn(`[karbon-work] ${workKey} — batch failed (${failedCount}/${siblings.length}); status→"${env.karbon.errorStatus}" ${ok ? 'written to Karbon' : 'NOT written (see error above)'}`);
  } else {
    console.warn(`[karbon-work] ${workKey} — batch failed (${failedCount}/${siblings.length}); no PROPAGO_ERROR_STATUS set, leaving work item status unchanged (Timeline failure note stands)`);
  }
}
