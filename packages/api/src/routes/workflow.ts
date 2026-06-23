/**
 * `GET /workflow/:id → state` — the receipt surface for the UI. Joins the persisted
 * record (merchant, cart, estimate) with the live Temporal status query. Returns
 * secret-free state only (no card secret, no PII values).
 */
import type { Hono } from 'hono';
import { ok, fail, errMessage } from '../http.js';
import type { AppDeps } from '../app-deps.js';

export function registerWorkflowRoute(app: Hono, deps: AppDeps): void {
  app.get('/workflow/:id', async (c) => {
    const id = c.req.param('id');
    const record = deps.store.get(id);
    if (!record) return c.json(fail(`unknown workflow '${id}'`), 404);

    try {
      const status = await deps.temporal.status(id);
      return c.json(
        ok({
          workflowId: id,
          status,
          path: 'P2',
          merchant: record.routedMerchant,
          cart: record.intent.cart_spec,
          estimateCents: record.estimateCents,
          priceCeilingCents: record.intent.price_ceiling_cents,
        }),
      );
    } catch (err) {
      return c.json(fail(`status query failed: ${errMessage(err)}`), 502);
    }
  });
}
