/**
 * `POST /execute  RoutingDecision → starts the Temporal checkout workflow`.
 *
 * Only the live path (P2 guest checkout) is wired; any other path is refused with
 * 422 (the router already encodes EXPLAIN_CANT for unsupported merchants). The
 * original TaskIntent is persisted so `/approval/resolve` can rebuild the mandate.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { CheckoutWorkflowArgs } from '@tomo/orchestrator';
import { ok, fail, errMessage } from '../http.js';
import { ExecuteRequestSchema } from '../schemas.js';
import { newWorkflowId, type AppDeps } from '../app-deps.js';

export function registerExecuteRoute(app: Hono, deps: AppDeps): void {
  app.post('/execute', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = ExecuteRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(fail(`invalid /execute body: ${parsed.error.message}`), 400);

    const { userId, intent, routing } = parsed.data;
    if (routing.path !== 'P2') {
      return c.json(fail(`path '${routing.path}' is not wired live in this build (only P2 guest checkout)`), 422);
    }
    // Hard guardrail: the routed merchant must equal the intent's merchant.
    if (routing.merchant_id !== intent.merchant_id) {
      return c.json(fail('merchant mismatch between routing and intent'), 422);
    }

    const estimateCents = parsed.data.estimateCents ?? intent.price_ceiling_cents;
    const workflowId = newWorkflowId(intent.merchant_id, randomUUID());
    const args: CheckoutWorkflowArgs = {
      userId,
      intent,
      routedMerchant: routing.merchant_id,
      estimateCents,
      ...(deps.tApproveMs !== undefined ? { tApproveMs: deps.tApproveMs } : {}),
      ...(deps.maxRetries !== undefined ? { maxRetries: deps.maxRetries } : {}),
    };

    try {
      await deps.temporal.start(args, workflowId);
    } catch (err) {
      return c.json(fail(`failed to start checkout: ${errMessage(err)}`), 502);
    }

    deps.store.put({ workflowId, userId, intent, routedMerchant: routing.merchant_id, estimateCents });
    return c.json(ok({ workflowId, path: 'P2', estimateCents }));
  });
}
