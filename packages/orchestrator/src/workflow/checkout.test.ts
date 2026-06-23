/**
 * Live-server integration tests for the durable checkout workflow.
 *
 * Runs against a REAL Temporal dev server (TestWorkflowEnvironment.createLocal —
 * no time-skipping), per the phase-04 decision to require a live server. The
 * workflow is registered from the pre-built `dist/workflow.js` bundle so the
 * worker's bundler never has to resolve TS `.js` specifiers.
 *
 * These exercise the headline guarantee end-to-end: an order whose confirmation
 * read fails is reconciled against the event store and settles WITHOUT a second
 * place-order.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { CardRef, ChargeEvent, TaskIntent } from '@tomo/core';
import {
  createActivities,
  createMandate,
  generateKeyPair,
  hashIntent,
  CheckoutStatus,
  CHECKOUT_TASK_QUEUE,
  type ApprovalDetails,
  type CheckoutDeps,
} from '../index.js';
import { approveSignal, type CheckoutWorkflowArgs } from './checkout.js';

const workflowsPath = fileURLToPath(new URL('../../dist/workflow.js', import.meta.url));
const PASS = 'integration-pass!';

const intent: TaskIntent = {
  merchant_id: 'merchant.example',
  cart_spec: { natural: '2x oat milk latte', items: [{ name: 'oat milk latte', qty: 2 }] },
  price_ceiling_cents: 2000,
  account_bound: true,
  ship_to_ref: 'vaultB:addr-1',
};

const APPROVED_TOTAL = 1850;

function authorizedEvent(cardId: string): ChargeEvent {
  return { type: 'transaction.authorized', cardId, amountCents: APPROVED_TOTAL, txId: 't1', occurredAt: '2026-06-22T10:00:00.000Z' };
}

interface MockOverrides {
  events?: ChargeEvent[];
  cardSpent?: boolean;
  orderFound?: boolean;
  placeOrderImpl?: () => Promise<{ placed: boolean }>;
}

function makeDeps(over: MockOverrides = {}) {
  const card: CardRef = {
    cardId: 'card_test',
    cardholderId: 'ch_1',
    merchantId: intent.merchant_id,
    amountCents: APPROVED_TOTAL,
    status: 'active',
  };
  const placeOrder = vi.fn(over.placeOrderImpl ?? (async () => ({ placed: true })));
  const closeCard = vi.fn(async () => {});
  const enqueueAccountClaim = vi.fn(async () => {});
  const deps: CheckoutDeps = {
    issueCard: async (_u, amountCents, merchantId) => ({ ...card, amountCents, merchantId }),
    closeCard,
    revalidate: async () => ({ priceCents: APPROVED_TOTAL, inStock: true }),
    placeOrder,
    getEvents: async () => over.events ?? [],
    isCardSpent: async () => over.cardSpent ?? false,
    findMerchantOrder: async () => over.orderFound ?? false,
    enqueueAccountClaim,
  };
  return { deps, placeOrder, closeCard, enqueueAccountClaim, cardId: card.cardId };
}

function signedApproval(workflowId: string) {
  const keys = generateKeyPair(PASS);
  const details: ApprovalDetails = {
    txId: workflowId,
    merchant: intent.merchant_id,
    amountCents: APPROVED_TOTAL,
    intentHash: hashIntent(intent),
    timestamp: new Date().toISOString(),
  };
  return { mandate: createMandate(details, keys.privateKey, PASS), approvedTotalCents: APPROVED_TOTAL };
}

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

async function runWorkflow(
  deps: CheckoutDeps,
  workflowId: string,
  args: Partial<CheckoutWorkflowArgs>,
  drive?: (handle: Awaited<ReturnType<typeof env.client.workflow.start>>) => Promise<void>,
) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: CHECKOUT_TASK_QUEUE,
    workflowsPath,
    activities: createActivities(deps),
  });

  const workflowArgs: CheckoutWorkflowArgs = {
    userId: 'user_1',
    intent,
    routedMerchant: intent.merchant_id,
    estimateCents: APPROVED_TOTAL,
    tApproveMs: 60_000,
    maxRetries: 1,
    ...args,
  };

  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start('checkout', {
      args: [workflowArgs],
      taskQueue: CHECKOUT_TASK_QUEUE,
      workflowId,
    });
    if (drive) await drive(handle);
    return handle.result();
  });
}

describe('checkout workflow (live dev server)', () => {
  it('HEADLINE: order placed but confirmation read failed → SETTLED, NO double charge', async () => {
    const wfId = 'wf-double-charge';
    // placeOrder throws (confirmation read failed) but the event store shows the
    // authorization landed. Reconciliation must settle and never re-place.
    const { deps, placeOrder } = makeDeps({
      events: [authorizedEvent('card_test')],
      cardSpent: true,
      placeOrderImpl: async () => {
        throw new Error('confirmation read failed');
      },
    });

    const result = await runWorkflow(deps, wfId, {}, async (handle) => {
      await handle.signal(approveSignal, signedApproval(wfId));
    });

    expect(result.status).toBe(CheckoutStatus.SETTLED);
    expect(placeOrder).toHaveBeenCalledTimes(1); // the whole point: exactly once
  }, 60_000);

  it('happy path: approve → card issued → charge → SETTLED (one place-order)', async () => {
    const wfId = 'wf-happy';
    const { deps, placeOrder, closeCard } = makeDeps({ events: [authorizedEvent('card_test')], cardSpent: true });

    const result = await runWorkflow(deps, wfId, {}, async (handle) => {
      await handle.signal(approveSignal, signedApproval(wfId));
    });

    expect(result.status).toBe(CheckoutStatus.SETTLED);
    expect(result.cardId).toBe('card_test');
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(closeCard).not.toHaveBeenCalled(); // settled card is consumed, not closed
  }, 60_000);

  it('T_approve timeout → ABANDONED + account-claim enqueued (orphan cleanup)', async () => {
    const wfId = 'wf-timeout';
    const { deps, closeCard, enqueueAccountClaim } = makeDeps();

    // No approve signal; tiny timeout fires against the real server.
    const result = await runWorkflow(deps, wfId, { tApproveMs: 800 });

    expect(result.status).toBe(CheckoutStatus.ABANDONED);
    expect(result.reason).toBe('approval_timeout');
    expect(closeCard).not.toHaveBeenCalled(); // no card issued before approval
    expect(enqueueAccountClaim).toHaveBeenCalledTimes(1); // P3 account never left orphaned
  }, 60_000);

  it('abandoned after charge → closeCard releases the hold (orphan cleanup)', async () => {
    const wfId = 'wf-abandon-charge';
    // placeOrder fails, no charge recorded, card unused, no retry budget → ABANDONED.
    const { deps, closeCard, enqueueAccountClaim } = makeDeps({
      placeOrderImpl: async () => {
        throw new Error('place failed');
      },
    });

    const result = await runWorkflow(deps, wfId, { maxRetries: 0 }, async (handle) => {
      await handle.signal(approveSignal, signedApproval(wfId));
    });

    expect(result.status).toBe(CheckoutStatus.ABANDONED);
    expect(closeCard).toHaveBeenCalledTimes(1); // hold released
    expect(enqueueAccountClaim).toHaveBeenCalledTimes(1); // account-claim enqueued
  }, 60_000);

  it('invalid mandate → ABANDONED (replay/forgery rejected at the gate)', async () => {
    const wfId = 'wf-bad-mandate';
    const { deps, closeCard } = makeDeps();

    const result = await runWorkflow(deps, wfId, {}, async (handle) => {
      // Sign a mandate for a DIFFERENT amount than we approve — verification fails.
      const keys = generateKeyPair(PASS);
      const details: ApprovalDetails = {
        txId: wfId,
        merchant: intent.merchant_id,
        amountCents: 999,
        intentHash: hashIntent(intent),
        timestamp: new Date().toISOString(),
      };
      const mandate = createMandate(details, keys.privateKey, PASS);
      await handle.signal(approveSignal, { mandate, approvedTotalCents: APPROVED_TOTAL });
    });

    expect(result.status).toBe(CheckoutStatus.ABANDONED);
    expect(result.reason).toBe('invalid_mandate');
    expect(closeCard).not.toHaveBeenCalled();
  }, 60_000);
});
