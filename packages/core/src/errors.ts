/**
 * Error hierarchy. Every Tomo error extends `TomoError` (which extends the
 * native `Error`), carries a stable string `code`, and sets `name` to its class
 * name. The prototype chain is restored so `instanceof` works across the
 * transpile boundary (tsup → ES2022/CJS).
 *
 * Secret-flow note: error messages must never embed a PAN, CVV, password, or
 * vault field value. Carry references/ids, not secrets.
 */
export abstract class TomoError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    // Restore the prototype chain (TS target downlevels `extends Error`).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Funding-rail failures (card issue/hold/secret/close/reconcile). */
export class FundingError extends TomoError {
  readonly code = 'FUNDING_ERROR';
}

/** Routing-cascade failures (no path resolvable, guardrail violation). */
export class RoutingError extends TomoError {
  readonly code = 'ROUTING_ERROR';
}

/** Executor failures (page fill, injection, challenge handling). */
export class ExecutorError extends TomoError {
  readonly code = 'EXECUTOR_ERROR';
}

/** Vault failures (read/release/decrypt/access-control). */
export class VaultError extends TomoError {
  readonly code = 'VAULT_ERROR';
}

/** Approval-gate failures (not approved, timed out, mandate invalid). */
export class ApprovalError extends TomoError {
  readonly code = 'APPROVAL_ERROR';
}

/** Reconciliation/orphan-state-machine failures. */
export class ReconciliationError extends TomoError {
  readonly code = 'RECONCILIATION_ERROR';
}

/** Thrown by every stub package method until its phase implements it. */
export class NotImplementedError extends TomoError {
  readonly code = 'NOT_IMPLEMENTED';

  constructor(what = 'This method is not implemented yet.', options?: { cause?: unknown }) {
    super(what, options);
  }
}
