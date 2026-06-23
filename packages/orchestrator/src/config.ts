/**
 * Orchestrator constants. Kept in one place so the workflow, activities, and
 * tests agree on names, caps, and timers.
 */

/** Temporal task queue the checkout workflow + activities are registered on. */
export const CHECKOUT_TASK_QUEUE = 'tomo-checkout';

/** Default human-approval timeout. Carts go stale; 15 minutes is the §8 default. */
export const T_APPROVE_MS = 15 * 60 * 1000;

/**
 * Hard funding cap per single-use card ($50 in cents), independent of the
 * per-intent ceiling. A model-emitted amount above this is rejected outright.
 */
export const AMOUNT_CAP_CENTS = 5000;

/** Place-order retries allowed when reconciliation proves the card is unused. */
export const MAX_PLACE_ORDER_RETRIES = 1;
