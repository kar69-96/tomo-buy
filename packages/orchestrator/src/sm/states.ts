/**
 * The §8 checkout state machine: states + the allowed transition table.
 *
 *   CART_BUILT → AWAITING_APPROVAL → CARD_ISSUED → CHARGE_PENDING
 *                                                      ├─► SETTLED
 *                                                      ├─► DECLINED
 *                                                      ├─► ABANDONED
 *                                                      └─► NEEDS_RECON
 *
 * The human approval gate (AWAITING_APPROVAL) is OURS — a first-class state
 * driven by a Temporal timer + signal, NOT an Agentcard `202`. ABANDONED and
 * NEEDS_RECON are first-class outcomes, not error paths.
 *
 * This module is pure (no Temporal, no I/O) so the transition logic is fully
 * unit-testable and shared by the durable workflow.
 */

export const CheckoutStatus = {
  CART_BUILT: 'CART_BUILT',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  CARD_ISSUED: 'CARD_ISSUED',
  CHARGE_PENDING: 'CHARGE_PENDING',
  SETTLED: 'SETTLED',
  DECLINED: 'DECLINED',
  ABANDONED: 'ABANDONED',
  NEEDS_RECON: 'NEEDS_RECON',
} as const;

export type CheckoutStatus = (typeof CheckoutStatus)[keyof typeof CheckoutStatus];

/** The four terminal states the machine can come to rest in. */
const TERMINAL: ReadonlySet<CheckoutStatus> = new Set<CheckoutStatus>([
  CheckoutStatus.SETTLED,
  CheckoutStatus.DECLINED,
  CheckoutStatus.ABANDONED,
  CheckoutStatus.NEEDS_RECON,
]);

/** Allowed transitions. Anything not listed here is rejected by `canTransition`. */
const TRANSITIONS: Readonly<Record<CheckoutStatus, readonly CheckoutStatus[]>> = {
  [CheckoutStatus.CART_BUILT]: [CheckoutStatus.AWAITING_APPROVAL],
  [CheckoutStatus.AWAITING_APPROVAL]: [CheckoutStatus.CARD_ISSUED, CheckoutStatus.ABANDONED],
  [CheckoutStatus.CARD_ISSUED]: [CheckoutStatus.CHARGE_PENDING, CheckoutStatus.ABANDONED],
  [CheckoutStatus.CHARGE_PENDING]: [
    CheckoutStatus.SETTLED,
    CheckoutStatus.DECLINED,
    CheckoutStatus.ABANDONED,
    CheckoutStatus.NEEDS_RECON,
  ],
  [CheckoutStatus.SETTLED]: [],
  [CheckoutStatus.DECLINED]: [],
  [CheckoutStatus.ABANDONED]: [],
  [CheckoutStatus.NEEDS_RECON]: [],
};

/** True if `state` is one of the four terminal outcomes. */
export function isTerminal(state: CheckoutStatus): boolean {
  return TERMINAL.has(state);
}

/** True if `from → to` is a legal transition (and a no-op self-loop is never legal). */
export function canTransition(from: CheckoutStatus, to: CheckoutStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
