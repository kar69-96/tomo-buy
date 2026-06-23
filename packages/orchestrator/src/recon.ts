/**
 * Reconciliation-before-retry — the heart of double-charge prevention.
 *
 * A "place order" click can succeed at the merchant while our confirmation read
 * fails. Before ANY retry we consult two sources and decide deterministically:
 *
 *   1. the webhook event store (the reconciliation source of truth), and
 *   2. the merchant order state + whether the single-use card was spent.
 *
 * The single-use card is a deliberate fail-closed backstop: a retry against a
 * spent card fails by construction, so when in doubt we never re-place.
 *
 * Pure function — no Temporal, no I/O. The workflow passes in the facts.
 */
import type { ChargeEvent } from '@tomo/core';
import { MAX_PLACE_ORDER_RETRIES } from './config.js';

export type ReconDecision = 'SETTLED' | 'DECLINED' | 'RETRY_ONCE' | 'ABANDONED' | 'NEEDS_RECON';

export interface ReconInput {
  /** Card whose charge we are reconciling. */
  cardId: string;
  /** Append-only webhook event-store rows seen so far (any cards). */
  events: readonly ChargeEvent[];
  /** Does the funding rail report the single-use card as already consumed? */
  cardSpent: boolean;
  /** Does the merchant's own order state show an order was created? */
  orderFound: boolean;
  /** How many place-order attempts have already been made. */
  retriesUsed: number;
  /** Retry budget; defaults to the §8 "retry once" rule. */
  maxRetries?: number;
}

/** Was this card charged (authorized or cleared) and not subsequently voided? */
function chargeSettled(events: readonly ChargeEvent[], cardId: string): boolean {
  const forCard = events.filter((e) => e.cardId === cardId);
  const charged = forCard.some(
    (e) => e.type === 'transaction.authorized' || e.type === 'transaction.cleared',
  );
  const voided = forCard.some((e) => e.type === 'transaction.voided');
  return charged && !voided;
}

function explicitlyDeclined(events: readonly ChargeEvent[], cardId: string): boolean {
  return events.some((e) => e.cardId === cardId && e.type === 'transaction.declined');
}

/**
 * Decide what to do with a charge whose confirmation we couldn't read.
 *
 * - Charge present in the event store → SETTLED. Never re-place (no double charge).
 * - Explicit decline and no charge → DECLINED.
 * - No charge, card already spent → ABANDONED (fail-closed; ambiguous spend).
 * - No charge, card unused, merchant shows an order → NEEDS_RECON (human review;
 *   never auto-retry spend from a divergent state).
 * - No charge, card unused, no order → RETRY_ONCE (within budget) else ABANDONED.
 */
export function decideRecon(input: ReconInput): ReconDecision {
  const { cardId, events, cardSpent, orderFound, retriesUsed } = input;
  const maxRetries = input.maxRetries ?? MAX_PLACE_ORDER_RETRIES;

  // 1. The webhook event store is the source of truth. A charge means we're done.
  if (chargeSettled(events, cardId)) return 'SETTLED';

  // 2. An explicit decline with no offsetting charge is a terminal decline.
  if (explicitlyDeclined(events, cardId)) return 'DECLINED';

  // 3. No charge recorded, but the single-use card is spent → fail closed.
  if (cardSpent) return 'ABANDONED';

  // 4. Card unused but the merchant claims an order exists → divergent; human review.
  if (orderFound) return 'NEEDS_RECON';

  // 5. No charge, card unused, no order → safe to retry within budget.
  return retriesUsed < maxRetries ? 'RETRY_ONCE' : 'ABANDONED';
}
