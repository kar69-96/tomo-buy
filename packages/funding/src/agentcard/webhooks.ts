import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChargeEventSchema, FundingError, type ChargeEvent } from '@tomo/core';
import type { WebhookEventStore } from './event-store.js';

/**
 * Webhook signature verification + event-store ingestion.
 *
 * Agentcard delivers signed JSON POSTs with a timestamped `AgentCard-Signature`
 * header and a `whsec_` signing secret (shown once at endpoint creation). We
 * recompute the HMAC-SHA256 over the RAW body and constant-time compare before
 * trusting the payload. Verified events are appended to the reconciliation store.
 *
 * Header format (Stripe-style, since payment methods are Stripe-backed):
 *   `t=<unixSeconds>,v1=<hexHmac>`  where the signed payload is `${t}.${rawBody}`.
 * A bare hex string is also accepted and verified directly against the raw body
 * (the exact scheme is a documented TO-CONFIRM — see 03-agentcard-client.md §3).
 */

const SIGNATURE_HEADER = 'AgentCard-Signature';

/** Parse `t=...,v1=...` into parts; returns null if it isn't that shape. */
function parseSignatureHeader(header: string): { t: string; v1: string } | null {
  const parts = header.split(',').map((p) => p.trim());
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === 't') t = val;
    else if (key === 'v1') v1 = val;
  }
  if (t && v1) return { t, v1 };
  return null;
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Constant-time hex compare that never throws on length mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify the signature against the raw body. Returns true on match. Pure — does
 * not touch the store. Exposed for unit testing the crypto path in isolation.
 */
export function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (parsed) {
    const expected = hmacHex(secret, `${parsed.t}.${rawBody}`);
    return safeEqualHex(parsed.v1, expected);
  }

  // Bare-hex fallback: HMAC of the raw body directly.
  const expected = hmacHex(secret, rawBody);
  return safeEqualHex(signatureHeader.trim(), expected);
}

/**
 * Verify, parse, and ingest a webhook delivery. Throws FundingError on a bad
 * signature or an unparseable/invalid payload (never silently swallow). On
 * success the validated ChargeEvent is appended to the store and returned.
 */
export function verifyAndIngest(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string,
  store: WebhookEventStore,
): ChargeEvent {
  if (!signatureHeader) {
    throw new FundingError(`Webhook rejected: missing ${SIGNATURE_HEADER} header.`);
  }
  if (!verifySignature(rawBody, signatureHeader, secret)) {
    throw new FundingError('Webhook rejected: signature verification failed.');
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (cause) {
    throw new FundingError('Webhook rejected: body is not valid JSON.', { cause });
  }

  const result = ChargeEventSchema.safeParse(json);
  if (!result.success) {
    throw new FundingError(`Webhook rejected: payload failed schema validation (${result.error.message}).`);
  }

  return store.append(result.data);
}
