import { ChargeEventSchema, type ChargeEvent } from '@tomo/core';

/**
 * Append-only webhook event store, keyed by card id. This is the reconciliation
 * source of truth for the §8 state machine — there is no documented Agentcard
 * "list transactions" endpoint, so `listTransactions` projects this store.
 *
 * Immutability: stored events are validated copies; reads return fresh arrays so
 * callers cannot mutate internal state.
 */
export class WebhookEventStore {
  private readonly byCardId = new Map<string, ChargeEvent[]>();

  /** Validate at the boundary, then append an immutable copy keyed by cardId. */
  append(event: ChargeEvent): ChargeEvent {
    const validated = ChargeEventSchema.parse(event);
    const existing = this.byCardId.get(validated.cardId) ?? [];
    this.byCardId.set(validated.cardId, [...existing, validated]);
    return validated;
  }

  /** All events for a card, in append order. Returns a fresh array (no aliasing). */
  byCard(cardId: string): ChargeEvent[] {
    return [...(this.byCardId.get(cardId) ?? [])];
  }

  /** Total events stored (across all cards). */
  get size(): number {
    let n = 0;
    for (const events of this.byCardId.values()) n += events.length;
    return n;
  }
}
