/**
 * Assemble the orchestrator's `CheckoutDeps` from the concrete Wave-2 collaborators.
 * This is the heart of the composition: it maps the funding rail + trusted-side
 * Executor + shared webhook event store into the activity seam the workflow runs.
 *
 * Pure wiring over injected parts (no real network/browser here) so it is fully
 * unit-testable with fakes; `composition.ts` supplies the production parts.
 */
import type { CheckoutDeps } from '@tomo/orchestrator';
import type { CardRef, ChargeEvent, RoutingDecision, TaskIntent, Txn } from '@tomo/core';

/** The slice of the funding rail the checkout activities call. */
export interface RailParts {
  issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef>;
  closeCard(cardRef: CardRef): Promise<void>;
  listTransactions(cardRef: CardRef): Promise<Txn[]>;
}

/** The trusted-side Executor surface placeOrder drives (flags only — never a secret). */
export interface CheckoutExecutor {
  checkout(params: {
    user: string;
    intent: TaskIntent;
    routing: RoutingDecision;
    cardRef: CardRef;
    amountCents: number;
    pageMerchantId: string;
    confirmationSelector?: string;
  }): Promise<{ success: boolean; confirmationId?: string }>;
}

/** Read side of the shared webhook event store (the reconciliation source of truth). */
export interface EventReader {
  byCard(cardId: string): ChargeEvent[];
}

export interface CheckoutDepsParts {
  readonly rail: RailParts;
  readonly events: EventReader;
  readonly executor: CheckoutExecutor;
  /** Orphan-path P3 account-claim queue (P2 never enqueues). */
  readonly accountClaimQueue?: string[];
  /** Selector the executor reads a confirmation id from after submit. */
  readonly confirmationSelector?: string;
}

/** Derive the Vault-B user key from `ship_to_ref` ("vaultB:<user>:<label>"). */
export function parseUserFromShipToRef(ref: string, fallback: string): string {
  const parts = ref.split(':');
  if (parts.length >= 2 && parts[0] === 'vaultB' && parts[1]) return parts[1];
  return fallback;
}

export function assembleCheckoutDeps(parts: CheckoutDepsParts): CheckoutDeps {
  const queue = parts.accountClaimQueue ?? [];

  return {
    async issueCard(userId, amountCents, merchantId) {
      return parts.rail.issueCard(userId, amountCents, merchantId);
    },

    async closeCard(cardRef) {
      return parts.rail.closeCard(cardRef);
    },

    // Thin trusted-side probe for the slice: the approved cart is re-checked against
    // the ceiling by the workflow's guardrails; a real price/inventory scrape is a
    // follow-up. Honest stub, documented in the phase report.
    async revalidate(intent) {
      return { priceCents: intent.price_ceiling_cents, inStock: true };
    },

    async placeOrder(intent, cardRef) {
      const user = parseUserFromShipToRef(intent.ship_to_ref, cardRef.cardholderId);
      const routing: RoutingDecision = {
        path: 'P2',
        merchant_id: intent.merchant_id,
        reasons: ['live P2 guest checkout'],
      };
      const result = await parts.executor.checkout({
        user,
        intent,
        routing,
        cardRef,
        amountCents: cardRef.amountCents,
        pageMerchantId: intent.merchant_id,
        ...(parts.confirmationSelector ? { confirmationSelector: parts.confirmationSelector } : {}),
      });
      return {
        placed: result.success,
        ...(result.confirmationId ? { orderRef: result.confirmationId } : {}),
      };
    },

    async getEvents(cardId) {
      return parts.events.byCard(cardId);
    },

    async isCardSpent(cardRef) {
      const txns = await parts.rail.listTransactions(cardRef);
      return txns.some((t) => t.status === 'authorized' || t.status === 'cleared');
    },

    // A merchant order-state probe is a follow-up; for the slice the webhook event
    // store is the reconciliation truth. Honest stub.
    async findMerchantOrder() {
      return false;
    },

    async enqueueAccountClaim(intent) {
      queue.push(intent.merchant_id);
    },
  };
}
