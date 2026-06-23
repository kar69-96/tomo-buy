/**
 * @tomo/orchestrator — the Temporal approval/recon/orphan state machine (§8).
 *
 * Pure, deterministic core (states, reducer, recon, guards, mandate) plus the
 * durable workflow + its activity factory. Wave-3 injects the concrete
 * FundingRail/Executor/event-store via `CheckoutDeps`.
 */

// Pure state machine + decision logic (safe in the workflow sandbox).
export { CheckoutStatus, canTransition, isTerminal } from './sm/states.js';
export { reduce, type CheckoutEvent } from './sm/reducer.js';
export { decideRecon, type ReconDecision, type ReconInput } from './recon.js';
export { validateChargeParams, type ChargeParams } from './guards.js';

// Ed25519 approval mandate (node:crypto — trusted side only).
export {
  generateKeyPair,
  createMandate,
  verifyMandate,
  isMandateFresh,
  hashIntent,
  type KeyPair,
  type ApprovalDetails,
  type ApprovalMandate,
} from './mandate.js';

// Constants.
export {
  CHECKOUT_TASK_QUEUE,
  T_APPROVE_MS,
  AMOUNT_CAP_CENTS,
  MAX_PLACE_ORDER_RETRIES,
} from './config.js';

// Activities (factory + dependency seam for Wave-3 / tests).
export {
  createActivities,
  type CheckoutActivities,
  type CheckoutDeps,
  type ReconFacts,
  type RevalidationResult,
  type PlaceOrderResult,
} from './activities/index.js';

// Workflow handle: signals, queries, args/result types. (The workflow function
// itself is registered by path on the worker; the client references these.)
export {
  approveSignal,
  rejectSignal,
  statusQuery,
  type ApproveInput,
  type CheckoutWorkflowArgs,
  type CheckoutResult,
} from './workflow/checkout.js';
