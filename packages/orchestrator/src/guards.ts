/**
 * Hard guardrails re-validated at the approval gate, per the CLAUDE.md prime
 * directive: every model-emitted parameter is re-checked against deterministic
 * limits before any side effect. The LLM proposes; this module disposes.
 *
 * Pure — throws `ApprovalError` on violation, returns void on success.
 */
import { ApprovalError } from '@tomo/core';
import { AMOUNT_CAP_CENTS } from './config.js';

export interface ChargeParams {
  /** The amount we are about to issue a card / charge for, in CENTS. */
  amountCents: number;
  /** Per-intent ceiling the user authorized, in CENTS. */
  priceCeilingCents: number;
  /** Merchant the router actually resolved to. */
  routedMerchant: string;
  /** Merchant the model emitted for this charge. */
  merchant: string;
  /** Optional override of the absolute funding cap (defaults to AMOUNT_CAP_CENTS). */
  capCents?: number;
}

/**
 * Re-validate a charge before issuing a card or placing an order. Order of
 * checks is fixed so failures are predictable:
 *   1. amount is a non-negative integer number of cents,
 *   2. amount ≤ per-intent price ceiling,
 *   3. amount ≤ absolute funding cap ($50 default),
 *   4. emitted merchant === routed merchant.
 */
export function validateChargeParams(params: ChargeParams): void {
  const { amountCents, priceCeilingCents, routedMerchant, merchant } = params;
  const cap = params.capCents ?? AMOUNT_CAP_CENTS;

  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new ApprovalError(`amountCents must be a non-negative integer (got ${amountCents}).`);
  }
  if (amountCents > priceCeilingCents) {
    throw new ApprovalError(
      `amountCents ${amountCents} exceeds price_ceiling_cents ${priceCeilingCents}.`,
    );
  }
  if (amountCents > cap) {
    throw new ApprovalError(`amountCents ${amountCents} exceeds the funding cap ${cap}.`);
  }
  if (merchant !== routedMerchant) {
    throw new ApprovalError(`merchant '${merchant}' does not match routed merchant '${routedMerchant}'.`);
  }
}
