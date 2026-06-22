import { ExecutorError } from '@tomo/core';

/**
 * §12 guardrail re-validation. Every model-emitted parameter is checked against
 * a hard constraint derived from TRUSTED state (the original TaskIntent, the
 * routing decision, the Vault B record) before any side effect. Page/email text
 * is treated as DATA: instruction-like content is surfaced to the user, never
 * acted on. Violations throw ExecutorError.
 */

/** A shipping/billing address assembled from Vault B fields. */
export interface Address {
  name?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/** Rule 1: the charge amount must not exceed the original intent's ceiling. */
export function assertAmountWithinCeiling(amountCents: number, ceilingCents: number): void {
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new ExecutorError(`Invalid amount: ${amountCents}.`);
  }
  if (amountCents > ceilingCents) {
    throw new ExecutorError(
      `Amount ${amountCents}¢ exceeds price ceiling ${ceilingCents}¢ — refusing.`,
    );
  }
}

/** Rule 2: the address used must equal the Vault B record, field for field. */
export function assertShipToFromVault(used: Address, vaultRecord: Address): void {
  const fields: (keyof Address)[] = ['name', 'street', 'city', 'state', 'zip', 'country'];
  for (const f of fields) {
    if ((used[f] ?? undefined) !== (vaultRecord[f] ?? undefined)) {
      throw new ExecutorError(
        `ship_to '${f}' does not match the Vault B record — refusing (possible page-injected address).`,
      );
    }
  }
}

/** Rule 3: the merchant acted on must equal the routed merchant. */
export function assertMerchantMatches(routedMerchantId: string, candidateMerchantId: string): void {
  if (routedMerchantId !== candidateMerchantId) {
    throw new ExecutorError(
      `Merchant '${candidateMerchantId}' does not match routed merchant '${routedMerchantId}' — refusing.`,
    );
  }
}

/**
 * Rule 4: scan page/email text for instruction-like content (prompt injection).
 * Returns the matched snippets so the caller can SURFACE them to the user. This
 * function never executes anything it finds.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /forward (?:your |the )?(?:code|otp|password|2fa)/i,
  /send (?:your |the )?(?:code|otp|password|verification)/i,
  /the user (?:has )?authoriz/i,
  /ignore (?:all |any )?(?:previous|prior) instructions/i,
  /disregard (?:the )?(?:above|previous)/i,
  /you are now/i,
  /enter (?:your |the )?(?:one[- ]?time|verification) code/i,
];

export function surfaceInstructions(pageText: string): string[] {
  const found: string[] = [];
  const lines = pageText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && INJECTION_PATTERNS.some((re) => re.test(trimmed))) {
      found.push(trimmed);
    }
  }
  return found;
}
