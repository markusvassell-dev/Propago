import { Router, Request, Response, raw } from 'express';
import { verifyKarbonSignature } from '../middleware/karbonHmac';
import { verifyKarbonWebhookSignature } from '../middleware/karbonWebhookSig';
import { karbonIdempotency, releaseIdempotencyKey, KarbonTriggerPayload } from '../middleware/idempotency';
import { createRunFromTrigger, ConflictError } from '../saga/orchestrator';
import { enqueue, QUEUE } from '../queues/queues';
import { extractResourcePermaKey } from '../services/karbonWork';

export const webhookRouter = Router();

// POST /api/webhooks/karbon
// Order matters: raw body capture → HMAC verify (rule 1) → idempotency SETNX
// (rule 1) → create the batch (exactly 3 runs — one per content set) + enqueue.
// Duplicate deliveries exit at the idempotency step with 200 so Karbon stops
// retrying; they can never enqueue a 4th run.
webhookRouter.post(
  '/karbon',
  raw({ type: '*/*', limit: '256kb' }), // req.body stays a Buffer for signature verification
  verifyKarbonSignature,
  karbonIdempotency,
  async (req: Request, res: Response) => {
    const payload = (req as Request & { karbonPayload: KarbonTriggerPayload }).karbonPayload;
    const idemKey = (req as Request & { idempotencyKey: string }).idempotencyKey;

    try {
      const extras = payload as KarbonTriggerPayload & {
        painPoint?: string;
        sourceInsight?: string;
        scheduled?: boolean;
      };
      const { runIds, runNos } = await createRunFromTrigger(
        {
          workItemId: payload.workItemId,
          stageId: payload.stageId,
          clientName: payload.clientName ?? '',
          topic: payload.topic,
          keywords: payload.keywords ?? [],
          tone: payload.tone ?? 'Authoritative, plainspoken'
        },
        {
          painPointHint: extras.painPoint,
          sourceInsightHint: extras.sourceInsight,
          scheduled: !!extras.scheduled
        }
      );
      res.status(202).json({ ok: true, runIds, runNos });
    } catch (err) {
      if (err instanceof ConflictError) {
        // DB unique constraint caught a duplicate the Redis key missed
        // (e.g. Redis flushed) — still a graceful 200.
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      // Run creation failed for a real reason: release the idempotency lock so
      // Karbon's retry can succeed once the underlying issue is fixed.
      await releaseIdempotencyKey(idemKey);
      console.error('[webhook:karbon]', err);
      res.status(500).json({ error: 'trigger_failed' });
    }
  }
);

// POST /api/webhooks/karbon/work
// Karbon's NATIVE Work webhook (WebhookType="Work"). Fires on ANY work item
// update, so it must: ack fast (Karbon cancels a subscription that is slow or
// errors), verify Karbon's signature when a signing key is set, then hand the
// event to the karbon-inbound worker which fetches the full work item, checks
// the activation status, and (only then) triggers Propago. All the real work is
// async on purpose — the HTTP response here is just an acknowledgement.
webhookRouter.post(
  '/karbon/work',
  raw({ type: '*/*', limit: '256kb' }), // Buffer body for signature verification
  verifyKarbonWebhookSignature,
  async (req: Request, res: Response) => {
    let payload: unknown;
    try {
      payload = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }

    const permaKey = extractResourcePermaKey(payload);
    if (!permaKey) {
      // Ack with 200 (not an error) so Karbon doesn't retry an event we simply
      // can't act on — e.g. a webhook shape without a work-item resource key.
      console.warn('[karbon-work] webhook received with no ResourcePermaKey — acknowledged, ignored');
      res.status(200).json({ ok: true, ignored: 'no_resource_key' });
      return;
    }

    // Enqueue and return immediately. The worker owns fetch → decide → trigger.
    await enqueue(QUEUE.karbonInbound, 'work-event', { permaKey, payload });
    console.info(`[karbon-work] webhook accepted for ${permaKey} — queued for processing`);
    res.status(202).json({ ok: true, queued: true, resourcePermaKey: permaKey });
  }
);
