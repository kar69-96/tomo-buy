import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { FundingError } from '@tomo/core';
import { verifyAndIngest, verifySignature } from './webhooks.js';
import { WebhookEventStore } from './event-store.js';

const secret = 'whsec_testsecret';

function sign(rawBody: string, t = '1700000000'): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function bareSign(rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

const event = {
  type: 'transaction.cleared',
  cardId: 'card_1',
  txId: 'tx_1',
  amountCents: 2500,
  occurredAt: '2026-06-22T00:00:00.000Z',
};

describe('verifySignature', () => {
  it('accepts a valid t=,v1= signature', () => {
    const raw = JSON.stringify(event);
    expect(verifySignature(raw, sign(raw), secret)).toBe(true);
  });

  it('accepts a valid bare-hex signature', () => {
    const raw = JSON.stringify(event);
    expect(verifySignature(raw, bareSign(raw), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const raw = JSON.stringify(event);
    const header = sign(raw);
    expect(verifySignature(raw + ' ', header, secret)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const raw = JSON.stringify(event);
    expect(verifySignature(raw, sign(raw), 'whsec_wrong')).toBe(false);
  });

  it('rejects empty header or secret', () => {
    expect(verifySignature('{}', '', secret)).toBe(false);
    expect(verifySignature('{}', 'deadbeef', '')).toBe(false);
  });
});

describe('verifyAndIngest', () => {
  it('verifies, validates, and appends the event to the store', () => {
    const store = new WebhookEventStore();
    const raw = JSON.stringify(event);
    const out = verifyAndIngest(raw, sign(raw), secret, store);
    expect(out.txId).toBe('tx_1');
    expect(store.byCard('card_1')).toHaveLength(1);
  });

  it('rejects a missing signature header', () => {
    const store = new WebhookEventStore();
    expect(() => verifyAndIngest('{}', undefined, secret, store)).toThrow(/missing/);
    expect(store.size).toBe(0);
  });

  it('rejects a bad signature without storing', () => {
    const store = new WebhookEventStore();
    const raw = JSON.stringify(event);
    expect(() => verifyAndIngest(raw, 'badc0ffee', secret, store)).toThrow(FundingError);
    expect(store.size).toBe(0);
  });

  it('rejects non-JSON bodies', () => {
    const store = new WebhookEventStore();
    const raw = 'not json';
    expect(() => verifyAndIngest(raw, sign(raw), secret, store)).toThrow(/not valid JSON/);
  });

  it('rejects a payload that fails schema validation', () => {
    const store = new WebhookEventStore();
    const raw = JSON.stringify({ type: 'not.a.real.event', cardId: 'card_1', occurredAt: '2026-06-22T00:00:00.000Z' });
    expect(() => verifyAndIngest(raw, sign(raw), secret, store)).toThrow(/schema validation/);
  });
});
