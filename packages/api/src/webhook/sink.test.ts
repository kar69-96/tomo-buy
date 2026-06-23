import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookEventStore } from '@tomo/funding';
import { FundingError } from '@tomo/core';
import { makeWebhookSink } from './sink.js';

const SECRET = 'whsec_test_secret';

function sign(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody, 'utf8').digest('hex');
}

const event = {
  type: 'transaction.authorized',
  cardId: 'card_1',
  txId: 'tx_1',
  amountCents: 1800,
  occurredAt: '2026-06-22T12:00:00.000Z',
};

describe('makeWebhookSink', () => {
  it('verifies a good signature and appends to the shared store', () => {
    const store = new WebhookEventStore();
    const sink = makeWebhookSink(store, SECRET);
    const raw = JSON.stringify(event);
    const got = sink.ingest(raw, sign(raw));
    expect(got.cardId).toBe('card_1');
    expect(store.byCard('card_1')).toHaveLength(1);
  });

  it('rejects a bad signature (throws FundingError, nothing appended)', () => {
    const store = new WebhookEventStore();
    const sink = makeWebhookSink(store, SECRET);
    const raw = JSON.stringify(event);
    expect(() => sink.ingest(raw, 'deadbeef')).toThrow(FundingError);
    expect(store.size).toBe(0);
  });

  it('rejects a missing signature header', () => {
    const store = new WebhookEventStore();
    const sink = makeWebhookSink(store, SECRET);
    expect(() => sink.ingest(JSON.stringify(event), undefined)).toThrow(FundingError);
  });

  it('requires a non-empty secret at construction', () => {
    expect(() => makeWebhookSink(new WebhookEventStore(), '')).toThrow();
  });
});
