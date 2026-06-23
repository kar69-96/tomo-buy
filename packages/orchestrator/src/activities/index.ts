/**
 * Temporal activities — the trusted-side side-effecting steps the workflow drives.
 *
 * Activities run in a normal Node context (NOT the workflow sandbox), so this is
 * the ONLY place `node:crypto` (mandate verification) and real I/O may live.
 *
 * Phase-04 ships these as a thin factory over an injected `CheckoutDeps` so that:
 *   - Wave-3 wires the concrete `FundingRail` + Executor + event store, and
 *   - tests inject mocks.
 *
 * SECRET-FLOW RULE: `getCardSecret` never returns a PAN into workflow/test
 * context — it stays a fail-closed stub until the Wave-3 Executor lands. The
 * trusted-side `placeOrder` returns a FLAG only, never a secret.
 */
import { NotImplementedError, type CardRef, type ChargeEvent, type TaskIntent } from '@tomo/core';
import {
  createMandate as _createMandate,
  verifyMandate,
  isMandateFresh,
  hashIntent,
  type ApprovalDetails,
  type ApprovalMandate,
} from '../mandate.js';
import { T_APPROVE_MS } from '../config.js';

/** Facts gathered from the merchant + funding rail to re-validate at approval. */
export interface RevalidationResult {
  priceCents: number;
  inStock: boolean;
}

/** The reconciliation facts the workflow feeds into the pure `decideRecon`. */
export interface ReconFacts {
  events: ChargeEvent[];
  cardSpent: boolean;
  orderFound: boolean;
}

/** Result of a trusted-side order placement — a flag, never a secret. */
export interface PlaceOrderResult {
  placed: boolean;
  orderRef?: string;
}

/**
 * The dependency surface phase-04 leaves open for Wave-3 / tests. Each method is
 * a seam where a concrete implementation (Agentcard rail, Browserbase Executor,
 * webhook event store) gets injected.
 */
export interface CheckoutDeps {
  /** Issue a single-use card for the APPROVED total (cents). */
  issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef>;
  /** Release the hold on a card. Always called on the ABANDONED orphan path. */
  closeCard(cardRef: CardRef): Promise<void>;
  /** Re-validate price + inventory at approval time (carts go stale). */
  revalidate(intent: TaskIntent): Promise<RevalidationResult>;
  /** Trusted-side order placement (Wave-3 Executor). Returns a flag only. */
  placeOrder(intent: TaskIntent, cardRef: CardRef): Promise<PlaceOrderResult>;
  /** Query the webhook event store (reconciliation source of truth). */
  getEvents(cardId: string): Promise<ChargeEvent[]>;
  /** Is the single-use card already consumed per the funding rail? */
  isCardSpent(cardRef: CardRef): Promise<boolean>;
  /** Does the merchant's own order state show an order was created? */
  findMerchantOrder(intent: TaskIntent, cardId: string): Promise<boolean>;
  /** Orphan cleanup: enqueue an account-claim/teardown for a P3 account. */
  enqueueAccountClaim(intent: TaskIntent): Promise<void>;
}

/** Build the activity implementations bound to a concrete dependency set. */
export function createActivities(deps: CheckoutDeps) {
  return {
    /** Re-validate price + inventory; the workflow rejects stale/oversized carts. */
    async surfaceApproval(intent: TaskIntent): Promise<RevalidationResult> {
      return deps.revalidate(intent);
    },

    /**
     * Verify a signed approval mandate trusted-side (uses node:crypto). Returns
     * `true` only when the signature is valid, binds the exact intent + approved
     * total, and is within the freshness window.
     */
    async verifyApproval(args: {
      mandate: ApprovalMandate;
      intent: TaskIntent;
      approvedTotalCents: number;
      txId: string;
      nowMs: number;
      maxAgeMs?: number;
    }): Promise<boolean> {
      const details: ApprovalDetails = {
        txId: args.txId,
        merchant: args.intent.merchant_id,
        amountCents: args.approvedTotalCents,
        intentHash: hashIntent(args.intent),
        timestamp: args.mandate.timestamp,
      };
      if (!verifyMandate(args.mandate, details)) return false;
      return isMandateFresh(args.mandate, args.nowMs, args.maxAgeMs ?? T_APPROVE_MS);
    },

    /** Issue a single-use card for the approved total. */
    async issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef> {
      return deps.issueCard(userId, amountCents, merchantId);
    },

    /** Place the order trusted-side. NEVER auto-retried by Temporal (see workflow). */
    async placeOrder(intent: TaskIntent, cardRef: CardRef): Promise<PlaceOrderResult> {
      return deps.placeOrder(intent, cardRef);
    },

    /** Gather reconciliation facts: event store + card-spent + merchant order. */
    async reconcile(cardRef: CardRef, intent: TaskIntent): Promise<ReconFacts> {
      const [events, cardSpent, orderFound] = await Promise.all([
        deps.getEvents(cardRef.cardId),
        deps.isCardSpent(cardRef),
        deps.findMerchantOrder(intent, cardRef.cardId),
      ]);
      return { events, cardSpent, orderFound };
    },

    /** Release the Agentcard hold. Idempotent; always safe to call. */
    async closeCard(cardRef: CardRef): Promise<void> {
      await deps.closeCard(cardRef);
    },

    /** Orphan cleanup for a P3 account created but not charged. */
    async enqueueAccountClaim(intent: TaskIntent): Promise<void> {
      await deps.enqueueAccountClaim(intent);
    },

    /** SECRET BOUNDARY: never returns a PAN in phase-04 — Executor lands Wave-3. */
    async getCardSecret(_cardRef: CardRef): Promise<never> {
      throw new NotImplementedError('getCardSecret — trusted-side Executor lands in Wave 3.');
    },

    /** OTP relay arrives with the email architecture in phase-05. */
    async relayOtp(_intent: TaskIntent): Promise<never> {
      throw new NotImplementedError('relayOtp — phase-05 email architecture.');
    },
  };
}

/** The activity interface the workflow proxies against (derived from the factory). */
export type CheckoutActivities = ReturnType<typeof createActivities>;

// Re-export so a trusted-side caller can mint mandates without reaching into mandate.ts.
export const createMandate = _createMandate;
