/**
 * The headline slice test: user text → TaskIntent → router → P2 → Temporal workflow
 * → trusted-side guest checkout (real Executor + atomic PAN swap over a mock
 * checkout form) → approval gate → card issued → order placed → webhook reconciliation
 * → SETTLED. Runs against a REAL Temporal dev server (no time-skipping).
 *
 * Prime-directive assertion: the agent transcript + server logs never contain the
 * distinctive PAN/CVV/PII fixtures — only the in-page swap map does.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { buildWorker } from '@tomo/worker';
import { Executor } from '@tomo/executor';
import { VaultB, InMemoryStore } from '@tomo/vaults';
import { WebhookEventStore } from '@tomo/funding';
import type { Hono } from 'hono';
import { createApp } from './server.js';
import { makeTemporalAdapter } from './temporal.js';
import { makeWebhookSink } from './webhook/sink.js';
import { createMandateSigner } from './mandate-signer.js';
import { WorkflowStore } from './workflow-store.js';
import { OtpRelay } from './otp/relay.js';
import { assembleCheckoutDeps, type CheckoutExecutor } from './checkout-deps.js';
import {
  FakeCheckoutDriver,
  FakeFundingRail,
  stubComplete,
  fakeGetProfile,
  GUEST_RAW_INTENT,
  SECRET,
  PII,
  ALL_SECRET_VALUES,
} from './test-support/fakes.js';

const WEBHOOK_SECRET = 'whsec_integration';
const PASS = 'integration-pass';
const TASK_QUEUE = 'tomo-api-e2e';

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe('Lane B P2 guest checkout — end to end', () => {
  it('drives text → … → SETTLED with no secret in the transcript', async () => {
    // --- Shared trusted-side state ---
    const eventStore = new WebhookEventStore();
    const fakeRail = new FakeFundingRail(eventStore);

    // Real Vault B holding the guest's PII (distinctive fixtures for the leak grep).
    const vaultB = new VaultB(new InMemoryStore(), 'master-key-123');
    await vaultB.setRecord('user1', { ...PII });

    // Real Executor over a mock checkout form. Transcript/logs are the agent-visible sinks.
    const transcript: string[] = [];
    const logs: string[] = [];
    const driver = new FakeCheckoutDriver();
    const executor = new Executor({
      driver,
      vaultB,
      getCardSecret: () => fakeRail.getCardSecret(),
      transcript,
      logger: (m) => logs.push(m),
    });

    // `app` is referenced by the executor wrapper (late binding — checkout runs once
    // the server is driving). Placing the order models Agentcard delivering the
    // `transaction.authorized` webhook to our endpoint.
    let app: Hono;
    const executorWithWebhook: CheckoutExecutor = {
      async checkout(params) {
        const result = await executor.checkout(params);
        const evt = {
          type: 'transaction.authorized',
          cardId: params.cardRef.cardId,
          txId: `tx-${params.cardRef.cardId}`,
          amountCents: params.cardRef.amountCents,
          occurredAt: new Date().toISOString(),
        };
        const raw = JSON.stringify(evt);
        const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
        await app.request('/webhook', {
          method: 'POST',
          headers: { 'AgentCard-Signature': sig },
          body: raw,
        });
        return result;
      },
    };

    const deps = assembleCheckoutDeps({
      rail: fakeRail,
      events: eventStore,
      executor: executorWithWebhook,
      confirmationSelector: '#confirmation',
    });

    const { worker, close } = await buildWorker({
      deps,
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
    });

    app = createApp({
      temporal: makeTemporalAdapter(env.client, TASK_QUEUE),
      complete: stubComplete(GUEST_RAW_INTENT),
      getProfile: fakeGetProfile(),
      signer: createMandateSigner(PASS),
      store: new WorkflowStore(),
      otp: new OtpRelay(),
      webhook: makeWebhookSink(eventStore, WEBHOOK_SECRET),
      tApproveMs: 60_000,
      maxRetries: 1,
    });

    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const statusOf = async (id: string) => {
      const res = await app.request(`/workflow/${encodeURIComponent(id)}`);
      return (await res.json()).data;
    };

    const waitFor = async (id: string, target: string) => {
      for (let i = 0; i < 200; i++) {
        const data = await statusOf(id);
        if (data?.status === target) return data;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${id} to reach ${target}`);
    };

    const trace: string[] = [];

    const finalState = await worker.runUntil(async () => {
      // 1. text → TaskIntent
      const intentJson = await (await post('/intent', { userId: 'user1', text: 'buy one widget' })).json();
      expect(intentJson.success).toBe(true);
      const intent = intentJson.data.intent;

      // 2. TaskIntent → RoutingDecision (P2)
      const routeJson = await (await post('/route', intent)).json();
      expect(routeJson.data.path).toBe('P2');

      // 3. RoutingDecision → start workflow
      const execJson = await (await post('/execute', {
        userId: 'user1',
        intent,
        routing: routeJson.data,
        estimateCents: 1800,
      })).json();
      const workflowId = execJson.data.workflowId as string;
      trace.push(`started ${workflowId}`);

      // 4. AWAITING_APPROVAL → approve
      await waitFor(workflowId, 'AWAITING_APPROVAL');
      trace.push('AWAITING_APPROVAL');
      const apprJson = await (await post('/approval/resolve', {
        workflowId,
        decision: 'approve',
        approvedTotalCents: 1800,
      })).json();
      expect(apprJson.success).toBe(true);

      // 5. card issued → order placed → webhook → reconcile → SETTLED
      const settled = await waitFor(workflowId, 'SETTLED');
      trace.push('SETTLED');
      return settled;
    });

    await close();

    // Reconciled terminal state.
    expect(finalState.status).toBe('SETTLED');
    expect(trace).toEqual([expect.stringContaining('started'), 'AWAITING_APPROVAL', 'SETTLED']);

    // The single-use card secret was injected trusted-side: it reached the in-page
    // swap map but NEVER the agent transcript or the server logs.
    expect(Object.values(driver.lastSwapMap)).toContain(SECRET.pan);
    const visible = [...transcript, ...logs].join('\n');
    for (const secret of ALL_SECRET_VALUES) {
      expect(visible).not.toContain(secret);
    }
  }, 90_000);
});
