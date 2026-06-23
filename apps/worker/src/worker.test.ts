/**
 * Worker boot smoke test against a REAL Temporal dev server
 * (TestWorkflowEnvironment.createLocal — no time-skipping).
 *
 * Proves the worker registers the `checkout` workflow + activities and runs a
 * checkout end-to-end through `buildWorker`, settling without a double charge.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { CardRef, ChargeEvent, TaskIntent } from '@tomo/core';
import {
  createMandate,
  generateKeyPair,
  hashIntent,
  CheckoutStatus,
  approveSignal,
  type ApprovalDetails,
  type CheckoutDeps,
  type CheckoutWorkflowArgs,
} from '@tomo/orchestrator';
import { buildWorker, workflowsPath } from './worker.js';
import { stubDeps } from './stub-deps.js';

const PASS = 'worker-test-pass!';
const APPROVED_TOTAL = 1850;

const intent: TaskIntent = {
  merchant_id: 'merchant.example',
  cart_spec: { natural: '2x oat milk latte' },
  price_ceiling_cents: 2000,
  account_bound: false,
  ship_to_ref: 'vaultB:addr-1',
};

function makeDeps() {
  const card: CardRef = {
    cardId: 'card_worker',
    cardholderId: 'ch_1',
    merchantId: intent.merchant_id,
    amountCents: APPROVED_TOTAL,
    status: 'active',
  };
  const event: ChargeEvent = {
    type: 'transaction.authorized',
    cardId: 'card_worker',
    amountCents: APPROVED_TOTAL,
    occurredAt: '2026-06-22T10:00:00.000Z',
  };
  const placeOrder = vi.fn(async () => ({ placed: true }));
  const deps: CheckoutDeps = {
    issueCard: async (_u, amountCents, merchantId) => ({ ...card, amountCents, merchantId }),
    closeCard: async () => {},
    revalidate: async () => ({ priceCents: APPROVED_TOTAL, inStock: true }),
    placeOrder,
    getEvents: async () => [event],
    isCardSpent: async () => true,
    findMerchantOrder: async () => true,
    enqueueAccountClaim: async () => {},
  };
  return { deps, placeOrder };
}

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe('worker boot (live dev server)', () => {
  it('resolves the pre-built workflow bundle path', () => {
    expect(workflowsPath).toMatch(/dist[/\\]workflow\.(c?js)$/);
  });

  it('builds a worker with the stub deps without throwing (registration smoke)', async () => {
    const { worker, close } = await buildWorker({
      deps: stubDeps,
      connection: env.nativeConnection,
      taskQueue: 'tomo-smoke',
    });
    expect(worker).toBeDefined();
    // Run then immediately stop so the native worker registration is released
    // cleanly (otherwise it lingers and collides with the next worker).
    await worker.runUntil(async () => {});
    await close(); // injected connection → close is a no-op, but must not throw
  });

  it('opens its own connection to the local dev server when none is injected', async () => {
    // No `connection` → buildWorker connects to the local `temporal server
    // start-dev` (localhost:7233) itself, and its `close()` owns + closes that
    // connection. Exercises the default-address + owned-connection branches.
    const { worker, close } = await buildWorker({ deps: stubDeps, taskQueue: 'tomo-own-conn' });
    expect(worker).toBeDefined();
    await worker.runUntil(async () => {});
    await close(); // owns the connection → actually closes it (must not throw)
  });

  it('runs a checkout end-to-end through the worker → SETTLED, one place-order', async () => {
    const { deps, placeOrder } = makeDeps();
    const taskQueue = 'tomo-e2e';
    const { worker, close } = await buildWorker({ deps, connection: env.nativeConnection, taskQueue });

    const wfId = 'wf-worker-e2e';
    const keys = generateKeyPair(PASS);
    const details: ApprovalDetails = {
      txId: wfId,
      merchant: intent.merchant_id,
      amountCents: APPROVED_TOTAL,
      intentHash: hashIntent(intent),
      timestamp: new Date().toISOString(),
    };
    const mandate = createMandate(details, keys.privateKey, PASS);

    const args: CheckoutWorkflowArgs = {
      userId: 'user_1',
      intent,
      routedMerchant: intent.merchant_id,
      estimateCents: APPROVED_TOTAL,
      tApproveMs: 60_000,
      maxRetries: 1,
    };

    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start('checkout', {
        args: [args],
        taskQueue,
        workflowId: wfId,
      });
      await handle.signal(approveSignal, { mandate, approvedTotalCents: APPROVED_TOTAL });
      return handle.result();
    });

    await close();

    expect(result.status).toBe(CheckoutStatus.SETTLED);
    expect(placeOrder).toHaveBeenCalledTimes(1);
  }, 60_000);
});
