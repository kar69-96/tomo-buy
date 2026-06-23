/**
 * Webhook ingestion sink. Reuses `@tomo/funding` `verifyAndIngest` — the canonical
 * `whsec_` HMAC-SHA256 verifier over the RAW body — and appends verified events to
 * the SAME `WebhookEventStore` the workflow's reconcile reads via `getEvents`.
 * That shared store is the reconciliation source of truth (§8).
 */
import { verifyAndIngest, type WebhookEventStore } from '@tomo/funding';
import type { ChargeEvent } from '@tomo/core';
import type { WebhookSink } from '../ports.js';

export function makeWebhookSink(store: WebhookEventStore, secret: string): WebhookSink {
  if (!secret) throw new Error('webhook sink requires a non-empty signing secret');
  return {
    ingest(rawBody: string, signatureHeader: string | undefined | null): ChargeEvent {
      // Throws FundingError on a bad signature / unparseable / invalid payload.
      return verifyAndIngest(rawBody, signatureHeader, secret, store);
    },
  };
}
