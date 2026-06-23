import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookEventStore } from '@tomo/funding';
import { verifyMandate, hashIntent, type ApprovalDetails } from '@tomo/orchestrator';
import type { TaskIntent, RoutingDecision } from '@tomo/core';
import { createApp } from './server.js';
import { WorkflowStore } from './workflow-store.js';
import { OtpRelay } from './otp/relay.js';
import { createMandateSigner } from './mandate-signer.js';
import { makeWebhookSink } from './webhook/sink.js';
import { FakeTemporalPort, stubComplete, fakeGetProfile, GUEST_RAW_INTENT } from './test-support/fakes.js';

const WEBHOOK_SECRET = 'whsec_unit';

function buildTestApp(overrides: { complete?: ReturnType<typeof stubComplete> } = {}) {
  const temporal = new FakeTemporalPort();
  const store = new WorkflowStore();
  const otp = new OtpRelay();
  const signer = createMandateSigner('unit-pass');
  const eventStore = new WebhookEventStore();
  const webhook = makeWebhookSink(eventStore, WEBHOOK_SECRET);
  const app = createApp({
    temporal,
    complete: overrides.complete ?? stubComplete(GUEST_RAW_INTENT),
    getProfile: fakeGetProfile(),
    signer,
    store,
    otp,
    webhook,
    now: () => new Date('2026-06-22T12:00:00.000Z'),
  });
  return { app, temporal, store, otp, signer, eventStore };
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const intent: TaskIntent = {
  merchant_id: 'guest-goods-co',
  cart_spec: { natural: 'one widget for guest checkout' },
  price_ceiling_cents: 2000,
  account_bound: false,
  ship_to_ref: 'vaultB:user1:default',
};

const routingP2: RoutingDecision = { path: 'P2', merchant_id: 'guest-goods-co', reasons: ['guest'] };

/** Execute once to register a workflow; returns its id. */
async function execute(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await post(app, '/execute', { userId: 'user1', intent, routing: routingP2, estimateCents: 1800 });
  const json = await res.json();
  return json.data.workflowId as string;
}

describe('portal + health', () => {
  it('serves the portal at GET /', async () => {
    const { app } = buildTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Tomo-buy');
  });

  it('serves a health check', async () => {
    const { app } = buildTestApp();
    const res = await app.request('/healthz');
    expect((await res.json()).success).toBe(true);
  });
});

describe('POST /intent', () => {
  it('parses a prompt into a TaskIntent (intent-only)', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/intent', { userId: 'user1', text: 'buy one widget' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.intent.merchant_id).toBe('guest-goods-co');
    expect(json.data.intent.ship_to_ref).toBe('vaultB:user1:default');
  });

  it('rejects a malformed body', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/intent', { userId: '' });
    expect(res.status).toBe(400);
  });

  it('surfaces a parser failure as 502', async () => {
    const { app } = buildTestApp({ complete: stubComplete('not json' as unknown as object) });
    const res = await post(app, '/intent', { userId: 'user1', text: 'buy one widget' });
    expect(res.status).toBe(502);
  });
});

describe('POST /route', () => {
  it('routes a guest merchant to P2', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/route', intent);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.path).toBe('P2');
  });

  it('404s an unknown merchant', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/route', { ...intent, merchant_id: 'nope-co' });
    expect(res.status).toBe(404);
  });

  it('400s a malformed intent', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/route', { merchant_id: 'guest-goods-co' });
    expect(res.status).toBe(400);
  });
});

describe('POST /execute', () => {
  it('starts the workflow for a P2 routing and persists the record', async () => {
    const { app, temporal, store } = buildTestApp();
    const res = await post(app, '/execute', { userId: 'user1', intent, routing: routingP2, estimateCents: 1800 });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(temporal.started).toHaveLength(1);
    expect(store.has(json.data.workflowId)).toBe(true);
  });

  it('defaults the estimate to the price ceiling when omitted', async () => {
    const { app, temporal } = buildTestApp();
    await post(app, '/execute', { userId: 'user1', intent, routing: routingP2 });
    expect(temporal.started[0]!.args.estimateCents).toBe(2000);
  });

  it('refuses a non-P2 path with 422', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/execute', {
      userId: 'user1',
      intent,
      routing: { path: 'EXPLAIN_CANT', merchant_id: 'guest-goods-co', reasons: ['x'] },
    });
    expect(res.status).toBe(422);
  });

  it('refuses a merchant mismatch with 422', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/execute', {
      userId: 'user1',
      intent,
      routing: { ...routingP2, merchant_id: 'other-co' },
    });
    expect(res.status).toBe(422);
  });

  it('maps a temporal start failure to 502', async () => {
    const { app, temporal } = buildTestApp();
    temporal.failStart = true;
    const res = await post(app, '/execute', { userId: 'user1', intent, routing: routingP2 });
    expect(res.status).toBe(502);
  });

  it('400s a malformed body', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/execute', { userId: 'user1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /approval/resolve', () => {
  it('signs a verifiable mandate and signals approve', async () => {
    const { app, temporal } = buildTestApp();
    const workflowId = await execute(app);
    const res = await post(app, '/approval/resolve', { workflowId, decision: 'approve', approvedTotalCents: 1800 });
    expect(res.status).toBe(200);
    expect(temporal.approved).toHaveLength(1);

    const { mandate } = temporal.approved[0]!.input;
    const details: ApprovalDetails = {
      txId: workflowId,
      merchant: intent.merchant_id,
      amountCents: 1800,
      intentHash: hashIntent(intent),
      timestamp: mandate.timestamp,
    };
    expect(verifyMandate(mandate, details)).toBe(true);
  });

  it('signals reject', async () => {
    const { app, temporal } = buildTestApp();
    const workflowId = await execute(app);
    const res = await post(app, '/approval/resolve', { workflowId, decision: 'reject' });
    expect(res.status).toBe(200);
    expect(temporal.rejected).toEqual([workflowId]);
  });

  it('400s approve without an approved total', async () => {
    const { app } = buildTestApp();
    const workflowId = await execute(app);
    const res = await post(app, '/approval/resolve', { workflowId, decision: 'approve' });
    expect(res.status).toBe(400);
  });

  it('422s an approved total above the ceiling', async () => {
    const { app } = buildTestApp();
    const workflowId = await execute(app);
    const res = await post(app, '/approval/resolve', { workflowId, decision: 'approve', approvedTotalCents: 9999 });
    expect(res.status).toBe(422);
  });

  it('404s an unknown workflow', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/approval/resolve', { workflowId: 'nope', decision: 'reject' });
    expect(res.status).toBe(404);
  });

  it('400s a malformed body', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/approval/resolve', { decision: 'maybe' });
    expect(res.status).toBe(400);
  });
});

describe('POST /otp/relay', () => {
  it('records a relayed code for a known workflow', async () => {
    const { app, otp } = buildTestApp();
    const workflowId = await execute(app);
    const res = await post(app, '/otp/relay', { workflowId, code: '123456' });
    expect(res.status).toBe(200);
    expect(otp.pending(workflowId)).toEqual(['123456']);
  });

  it('404s an unknown workflow', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/otp/relay', { workflowId: 'nope', code: '123456' });
    expect(res.status).toBe(404);
  });

  it('400s a malformed body', async () => {
    const { app } = buildTestApp();
    const res = await post(app, '/otp/relay', { workflowId: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /webhook', () => {
  const event = {
    type: 'transaction.authorized',
    cardId: 'card-user1',
    txId: 'tx-1',
    amountCents: 1800,
    occurredAt: '2026-06-22T12:00:00.000Z',
  };

  it('ingests a correctly-signed event', async () => {
    const { app } = buildTestApp();
    const raw = JSON.stringify(event);
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'AgentCard-Signature': sig },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.type).toBe('transaction.authorized');
  });

  it('401s a bad signature', async () => {
    const { app } = buildTestApp();
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'AgentCard-Signature': 'deadbeef' },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /workflow/:id', () => {
  it('returns the joined record + live status', async () => {
    const { app, temporal } = buildTestApp();
    const workflowId = await execute(app);
    temporal.statusByWf.set(workflowId, 'SETTLED');
    const res = await app.request(`/workflow/${encodeURIComponent(workflowId)}`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe('SETTLED');
    expect(json.data.merchant).toBe('guest-goods-co');
    expect(json.data.path).toBe('P2');
  });

  it('404s an unknown workflow', async () => {
    const { app } = buildTestApp();
    const res = await app.request('/workflow/nope');
    expect(res.status).toBe(404);
  });

  it('502s when the status query fails', async () => {
    const { app, temporal } = buildTestApp();
    const workflowId = await execute(app);
    temporal.failStatus = true;
    const res = await app.request(`/workflow/${encodeURIComponent(workflowId)}`);
    expect(res.status).toBe(502);
  });
});
