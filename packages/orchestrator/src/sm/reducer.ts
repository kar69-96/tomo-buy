/**
 * The pure checkout reducer: `reduce(status, event) → status`.
 *
 * Every state change in the durable workflow goes through here, so the legal
 * transition table in `states.ts` is enforced in exactly one place. Illegal
 * transitions throw `ReconciliationError` rather than silently no-op'ing — an
 * out-of-order event is a real defect, not something to swallow.
 *
 * Pure + immutable: it returns a status value, never mutates its inputs.
 */
import { ReconciliationError } from '@tomo/core';
import { CheckoutStatus, canTransition } from './states.js';
import type { ReconDecision } from '../recon.js';

export type CheckoutEvent =
  /** CART_BUILT → AWAITING_APPROVAL: the agent submits the cart for human approval. */
  | { type: 'SUBMIT' }
  /** AWAITING_APPROVAL → CARD_ISSUED: the human approved and the card was issued. */
  | { type: 'APPROVED' }
  /** AWAITING_APPROVAL → ABANDONED: T_approve elapsed with no decision. */
  | { type: 'APPROVAL_TIMEOUT' }
  /** AWAITING_APPROVAL → ABANDONED: the human declined. */
  | { type: 'APPROVAL_REJECTED' }
  /** CARD_ISSUED → CHARGE_PENDING: the order was placed against the card. */
  | { type: 'CHARGE_SUBMITTED' }
  /** CHARGE_PENDING → terminal (or stay, on RETRY_ONCE): reconciliation outcome. */
  | { type: 'RECONCILED'; decision: ReconDecision };

/** Map a reconciliation decision to its target status (RETRY_ONCE stays put). */
function reconTarget(current: CheckoutStatus, decision: ReconDecision): CheckoutStatus {
  switch (decision) {
    case 'SETTLED':
      return CheckoutStatus.SETTLED;
    case 'DECLINED':
      return CheckoutStatus.DECLINED;
    case 'ABANDONED':
      return CheckoutStatus.ABANDONED;
    case 'NEEDS_RECON':
      return CheckoutStatus.NEEDS_RECON;
    case 'RETRY_ONCE':
      // Stay in CHARGE_PENDING; the workflow will attempt one more place-order.
      return current;
  }
}

/** Compute the target status for an event, before legality is checked. */
function targetFor(status: CheckoutStatus, event: CheckoutEvent): CheckoutStatus {
  switch (event.type) {
    case 'SUBMIT':
      return CheckoutStatus.AWAITING_APPROVAL;
    case 'APPROVED':
      return CheckoutStatus.CARD_ISSUED;
    case 'APPROVAL_TIMEOUT':
    case 'APPROVAL_REJECTED':
      return CheckoutStatus.ABANDONED;
    case 'CHARGE_SUBMITTED':
      return CheckoutStatus.CHARGE_PENDING;
    case 'RECONCILED':
      return reconTarget(status, event.decision);
  }
}

/**
 * Apply `event` to `status` and return the next status. A RETRY_ONCE outcome is
 * a legal self-loop (stay in CHARGE_PENDING); any other illegal move throws.
 */
export function reduce(status: CheckoutStatus, event: CheckoutEvent): CheckoutStatus {
  const target = targetFor(status, event);

  // RETRY_ONCE legitimately keeps us in CHARGE_PENDING — not a table transition.
  if (target === status) {
    if (event.type === 'RECONCILED' && status === CheckoutStatus.CHARGE_PENDING) return status;
    throw new ReconciliationError(`Illegal transition: ${status} -[${event.type}]-> ${target}`);
  }

  if (!canTransition(status, target)) {
    throw new ReconciliationError(`Illegal transition: ${status} -[${event.type}]-> ${target}`);
  }
  return target;
}
