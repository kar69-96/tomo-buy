import { describe, it, expect } from 'vitest';
import type { ChargeEvent } from '@tomo/core';
import { decideRecon, type ReconInput } from './recon.js';

const cardId = 'card_123';

function event(type: ChargeEvent['type'], over: Partial<ChargeEvent> = {}): ChargeEvent {
  return { type, cardId, occurredAt: '2026-06-22T10:00:00.000Z', ...over };
}

function input(over: Partial<ReconInput> = {}): ReconInput {
  return { cardId, events: [], cardSpent: false, orderFound: false, retriesUsed: 0, ...over };
}

describe('decideRecon', () => {
  it('HEADLINE: order placed but confirmation read failed → charge in event store → SETTLED (no double charge)', () => {
    // The merchant accepted the order and Agentcard recorded the authorization,
    // but our confirmation read threw. Reconciliation must see the charge and
    // settle — it must NEVER instruct a second place-order.
    const decision = decideRecon(
      input({
        events: [event('transaction.authorized', { amountCents: 1850, txId: 't1' })],
        orderFound: false, // confirmation read failed, so we don't even know the order exists
        cardSpent: true,
      }),
    );
    expect(decision).toBe('SETTLED');
  });

  it('cleared charge also settles', () => {
    expect(decideRecon(input({ events: [event('transaction.cleared')], cardSpent: true }))).toBe(
      'SETTLED',
    );
  });

  it('authorized-then-voided is NOT treated as settled', () => {
    const decision = decideRecon(
      input({ events: [event('transaction.authorized'), event('transaction.voided')], cardSpent: true }),
    );
    expect(decision).toBe('ABANDONED'); // no live charge, card spent → fail closed
  });

  it('explicit decline with no charge → DECLINED', () => {
    expect(decideRecon(input({ events: [event('transaction.declined')] }))).toBe('DECLINED');
  });

  it('no charge + card unused + no order → RETRY_ONCE (within budget)', () => {
    expect(decideRecon(input({ retriesUsed: 0 }))).toBe('RETRY_ONCE');
  });

  it('no charge + card unused + no order + budget exhausted → ABANDONED', () => {
    expect(decideRecon(input({ retriesUsed: 1 }))).toBe('ABANDONED');
  });

  it('no charge + card spent → ABANDONED (fail-closed backstop)', () => {
    expect(decideRecon(input({ cardSpent: true }))).toBe('ABANDONED');
  });

  it('no charge + card unused + merchant shows an order → NEEDS_RECON (never auto-retry spend)', () => {
    expect(decideRecon(input({ orderFound: true }))).toBe('NEEDS_RECON');
  });

  it('ignores events for other cards', () => {
    const otherCharge = event('transaction.authorized', { cardId: 'other_card' });
    expect(decideRecon(input({ events: [otherCharge], retriesUsed: 0 }))).toBe('RETRY_ONCE');
  });

  it('respects a custom maxRetries budget', () => {
    expect(decideRecon(input({ retriesUsed: 1, maxRetries: 2 }))).toBe('RETRY_ONCE');
  });
});
