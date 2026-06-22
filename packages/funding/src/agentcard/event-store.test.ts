import { describe, it, expect } from 'vitest';
import { WebhookEventStore } from './event-store.js';
import type { ChargeEvent } from '@tomo/core';

const ev = (over: Partial<ChargeEvent> = {}): ChargeEvent => ({
  type: 'transaction.authorized',
  cardId: 'card_1',
  txId: 'tx_1',
  amountCents: 2500,
  occurredAt: '2026-06-22T00:00:00.000Z',
  ...over,
});

describe('WebhookEventStore', () => {
  it('appends events keyed by cardId in order', () => {
    const store = new WebhookEventStore();
    store.append(ev({ txId: 'tx_1' }));
    store.append(ev({ txId: 'tx_2', occurredAt: '2026-06-22T00:01:00.000Z' }));
    const events = store.byCard('card_1');
    expect(events.map((e) => e.txId)).toEqual(['tx_1', 'tx_2']);
    expect(store.size).toBe(2);
  });

  it('isolates events by card', () => {
    const store = new WebhookEventStore();
    store.append(ev({ cardId: 'card_1' }));
    store.append(ev({ cardId: 'card_2' }));
    expect(store.byCard('card_1')).toHaveLength(1);
    expect(store.byCard('card_2')).toHaveLength(1);
  });

  it('returns an empty array for an unknown card', () => {
    expect(new WebhookEventStore().byCard('nope')).toEqual([]);
  });

  it('returns a fresh array so callers cannot mutate internal state', () => {
    const store = new WebhookEventStore();
    store.append(ev());
    const first = store.byCard('card_1');
    first.push(ev({ txId: 'injected' }));
    expect(store.byCard('card_1')).toHaveLength(1);
  });

  it('validates the event at the boundary (rejects garbage)', () => {
    const store = new WebhookEventStore();
    // @ts-expect-error intentionally invalid
    expect(() => store.append({ type: 'bogus', cardId: 'c' })).toThrow();
  });
});
