/**
 * `POST /approval/resolve  {workflowId, decision, approvedTotalCents?}` — our human
 * approval gate. On `approve`, sign an Ed25519 mandate binding the exact cart +
 * approved total (rebuilt from the persisted intent) and signal the workflow; on
 * `reject`, signal reject. We never charge here — the workflow re-validates and
 * re-checks the mandate before issuing a card.
 */
import type { Hono } from 'hono';
import { ok, fail, errMessage } from '../http.js';
import { ApprovalRequestSchema } from '../schemas.js';
import type { AppDeps } from '../app-deps.js';

export function registerApprovalRoute(app: Hono, deps: AppDeps): void {
  app.post('/approval/resolve', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = ApprovalRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(fail(`invalid /approval/resolve body: ${parsed.error.message}`), 400);

    const { workflowId, decision, approvedTotalCents } = parsed.data;
    const record = deps.store.get(workflowId);
    if (!record) return c.json(fail(`unknown workflow '${workflowId}'`), 404);

    try {
      if (decision === 'reject') {
        await deps.temporal.reject(workflowId);
        return c.json(ok({ workflowId, decision: 'reject' }));
      }

      if (approvedTotalCents === undefined) {
        return c.json(fail('approvedTotalCents is required to approve'), 400);
      }
      // Defensive guardrail (the workflow re-checks): never approve above the ceiling.
      if (approvedTotalCents > record.intent.price_ceiling_cents) {
        return c.json(fail('approved total exceeds the intent price ceiling'), 422);
      }

      const timestamp = (deps.now ?? (() => new Date()))().toISOString();
      const mandate = deps.signer.sign(workflowId, record.intent, approvedTotalCents, timestamp);
      await deps.temporal.approve(workflowId, { mandate, approvedTotalCents });
      return c.json(ok({ workflowId, decision: 'approve', approvedTotalCents }));
    } catch (err) {
      return c.json(fail(`approval signal failed: ${errMessage(err)}`), 502);
    }
  });
}
