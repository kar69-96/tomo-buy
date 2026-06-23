/**
 * The durable checkout workflow — the §8 approval/recon/orphan state machine.
 *
 *   CART_BUILT → AWAITING_APPROVAL → CARD_ISSUED → CHARGE_PENDING
 *                                                      ├─► SETTLED
 *                                                      ├─► DECLINED
 *                                                      ├─► ABANDONED
 *                                                      └─► NEEDS_RECON
 *
 * The human approval gate is OURS: a Temporal timer (`T_approve`) plus an
 * `approve`/`reject` signal — NOT an Agentcard `202`. Idempotency is the whole
 * point: a placed order whose confirmation we couldn't read is reconciled
 * against the webhook event store BEFORE any retry, so we never double-charge.
 *
 * SANDBOX RULE: this file runs in Temporal's deterministic V8 isolate, so it may
 * NOT use `node:crypto` or real I/O. Mandate verification and all side effects
 * live in activities; `../mandate.js` is imported as a TYPE only.
 */
import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  workflowInfo,
} from '@temporalio/workflow';
import type { CardRef, TaskIntent } from '@tomo/core';
import type { CheckoutActivities } from '../activities/index.js';
import type { ApprovalMandate } from '../mandate.js';
import { CheckoutStatus } from '../sm/states.js';
import { reduce } from '../sm/reducer.js';
import { decideRecon, type ReconDecision } from '../recon.js';
import { validateChargeParams } from '../guards.js';
import { T_APPROVE_MS, MAX_PLACE_ORDER_RETRIES } from '../config.js';

/** Payload a human sends to approve: the signed mandate + the approved total. */
export interface ApproveInput {
  mandate: ApprovalMandate;
  approvedTotalCents: number;
}

export interface CheckoutWorkflowArgs {
  userId: string;
  intent: TaskIntent;
  /** Merchant the router resolved to; the emitted merchant must match it. */
  routedMerchant: string;
  /** Pre-approval price estimate (cents) — surfaced to the user, not charged. */
  estimateCents: number;
  /** Approval timeout override (ms); defaults to T_APPROVE_MS. Tiny in tests. */
  tApproveMs?: number;
  /** Place-order retry budget override; defaults to MAX_PLACE_ORDER_RETRIES. */
  maxRetries?: number;
}

export interface CheckoutResult {
  status: CheckoutStatus;
  cardId?: string;
  reason?: string;
}

export const approveSignal = defineSignal<[ApproveInput]>('approve');
export const rejectSignal = defineSignal<[]>('reject');
export const statusQuery = defineQuery<CheckoutStatus>('status');

// Idempotent reads + cleanup — safe for Temporal to retry on transient failure.
const acts = proxyActivities<CheckoutActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 5 },
});

// Mutating, non-idempotent steps — NEVER auto-retried by Temporal. A retried
// placeOrder/issueCard could double-charge or mint a second card; we own retries
// explicitly via reconciliation instead.
const mutating = proxyActivities<CheckoutActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

export async function checkout(args: CheckoutWorkflowArgs): Promise<CheckoutResult> {
  const tApproveMs = args.tApproveMs ?? T_APPROVE_MS;
  const maxRetries = args.maxRetries ?? MAX_PLACE_ORDER_RETRIES;

  let status: CheckoutStatus = CheckoutStatus.CART_BUILT;
  let approval: ApproveInput | undefined;
  let rejected = false;

  setHandler(approveSignal, (input) => {
    if (!approval && !rejected) approval = input;
  });
  setHandler(rejectSignal, () => {
    if (!approval) rejected = true;
  });
  setHandler(statusQuery, () => status);

  // CART_BUILT → AWAITING_APPROVAL.
  status = reduce(status, { type: 'SUBMIT' });

  // ── Human approval gate (ours, not Agentcard's) ──────────────────────────
  const decided = await condition(() => approval !== undefined || rejected, tApproveMs);

  if (!decided) {
    status = reduce(status, { type: 'APPROVAL_TIMEOUT' });
    await cleanupOrphan(args.intent, undefined);
    return { status, reason: 'approval_timeout' };
  }
  if (rejected || !approval) {
    status = reduce(status, { type: 'APPROVAL_REJECTED' });
    await cleanupOrphan(args.intent, undefined);
    return { status, reason: 'rejected' };
  }

  // Re-validate price + inventory at approval time — carts go stale.
  const reval = await acts.surfaceApproval(args.intent);
  if (!reval.inStock) {
    status = reduce(status, { type: 'APPROVAL_REJECTED' });
    await cleanupOrphan(args.intent, undefined);
    return { status, reason: 'inventory_stale' };
  }

  // Hard guardrails on the approved/model-emitted parameters.
  try {
    validateChargeParams({
      amountCents: approval.approvedTotalCents,
      priceCeilingCents: args.intent.price_ceiling_cents,
      routedMerchant: args.routedMerchant,
      merchant: args.intent.merchant_id,
    });
  } catch {
    status = reduce(status, { type: 'APPROVAL_REJECTED' });
    await cleanupOrphan(args.intent, undefined);
    return { status, reason: 'guardrail_violation' };
  }

  // Verify the signed, replay-resistant approval mandate (crypto in an activity).
  const mandateOk = await acts.verifyApproval({
    mandate: approval.mandate,
    intent: args.intent,
    approvedTotalCents: approval.approvedTotalCents,
    txId: workflowInfo().workflowId,
    nowMs: Date.now(),
    maxAgeMs: tApproveMs,
  });
  if (!mandateOk) {
    status = reduce(status, { type: 'APPROVAL_REJECTED' });
    await cleanupOrphan(args.intent, undefined);
    return { status, reason: 'invalid_mandate' };
  }

  // Issue a single-use card for the APPROVED total (not the estimate).
  const cardRef = await mutating.issueCard(
    args.userId,
    approval.approvedTotalCents,
    args.intent.merchant_id,
  );
  status = reduce(status, { type: 'APPROVED' }); // → CARD_ISSUED

  // ── Place order + reconcile-before-retry ─────────────────────────────────
  status = reduce(status, { type: 'CHARGE_SUBMITTED' }); // → CHARGE_PENDING
  let retriesUsed = 0;
  let decision: ReconDecision;
  for (;;) {
    try {
      await mutating.placeOrder(args.intent, cardRef);
    } catch {
      // "Order placed but confirmation read failed" lands here. Do NOT assume
      // failure — reconcile against the event store before deciding to retry.
    }

    const facts = await acts.reconcile(cardRef, args.intent);
    decision = decideRecon({
      cardId: cardRef.cardId,
      events: facts.events,
      cardSpent: facts.cardSpent,
      orderFound: facts.orderFound,
      retriesUsed,
      maxRetries,
    });

    if (decision === 'RETRY_ONCE') {
      retriesUsed += 1;
      continue;
    }
    break;
  }

  status = reduce(status, { type: 'RECONCILED', decision });

  // Orphan cleanup: release the hold and (for P3 accounts) enqueue a claim.
  // NEEDS_RECON deliberately leaves the card for a human; SETTLED consumed it.
  if (status === CheckoutStatus.ABANDONED || status === CheckoutStatus.DECLINED) {
    await cleanupOrphan(args.intent, cardRef);
  }

  return { status, cardId: cardRef.cardId };

  /** Always release any hold and never leave an orphaned PII-bearing account. */
  async function cleanupOrphan(intent: TaskIntent, cardRef: CardRef | undefined): Promise<void> {
    if (cardRef) {
      await acts.closeCard(cardRef);
    }
    if (intent.account_bound) {
      await acts.enqueueAccountClaim(intent);
    }
  }
}
