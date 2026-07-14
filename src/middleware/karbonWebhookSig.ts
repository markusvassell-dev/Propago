import { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

// Karbon NATIVE Work-webhook signature verification.
//
// Karbon signs the raw request body with the subscription's SigningKey using
// HMAC-SHA256 and sends the digest in a header. Unlike our internal
// /api/webhooks/karbon route (which we sign ourselves and always require), this
// verifies KARBON's signature and is only enforced when a signing key is
// configured (KARBON_WEBHOOK_SIGNING_KEY) — before you set one up, or in local
// dev, the check is skipped so you can still receive events.
//
// We are deliberately lenient about the exact header name and digest encoding
// because Karbon's scheme has varied: we look at a few known header names and
// accept either base64 or hex, comparing in constant time.

const SIGNATURE_HEADERS = ['karbon-signature', 'x-karbon-signature', 'signature', 'x-signature'];

/** Expose the matched raw signature (for logging) without leaking the key. */
export function readSignatureHeader(req: Request): string {
  for (const h of SIGNATURE_HEADERS) {
    const v = req.header(h);
    if (v) return v.startsWith('sha256=') ? v.slice(7) : v;
  }
  return '';
}

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * True when `provided` matches HMAC-SHA256(signingKey, rawBody) in hex or base64.
 * Pure + exported so it can be unit-tested without an HTTP request.
 */
export function karbonSignatureValid(rawBody: Buffer, provided: string, signingKey: string): boolean {
  if (!provided) return false;
  const hex = createHmac('sha256', signingKey).update(rawBody).digest('hex');
  const b64 = createHmac('sha256', signingKey).update(rawBody).digest('base64');
  return safeEqualStr(provided, hex) || safeEqualStr(provided, b64);
}

export function verifyKarbonWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  if (!Buffer.isBuffer(req.body)) {
    // Misconfiguration guard: the route MUST use express.raw().
    res.status(500).json({ error: 'raw_body_unavailable' });
    return;
  }

  // No signing key configured ⇒ accept (documented: set the key to enforce).
  if (!env.karbon.webhookSigningKey) {
    console.warn('[karbon-work] KARBON_WEBHOOK_SIGNING_KEY not set — accepting webhook WITHOUT signature verification');
    next();
    return;
  }

  const provided = readSignatureHeader(req);
  if (!provided) {
    console.warn('[karbon-work] signing key set but request carried no signature header — rejected');
    res.status(401).json({ error: 'missing_signature' });
    return;
  }

  if (!karbonSignatureValid(req.body, provided, env.karbon.webhookSigningKey)) {
    console.warn('[karbon-work] signature mismatch — rejected');
    res.status(401).json({ error: 'invalid_signature' });
    return;
  }

  console.info('[karbon-work] signature verified');
  next();
}
