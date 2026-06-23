/**
 * `POST /webhook` — Agentcard transaction/card events. Verify the `whsec_`
 * signature over the RAW body and append to the shared event store (the §8
 * reconciliation source of truth). A bad signature is a hard 401 — never trust an
 * unverified payload, never silently swallow.
 */
import type { Hono } from 'hono';
import { ok, fail, errMessage } from '../http.js';
import type { AppDeps } from '../app-deps.js';

const SIGNATURE_HEADER = 'AgentCard-Signature';

export function registerWebhookRoute(app: Hono, deps: AppDeps): void {
  app.post('/webhook', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header(SIGNATURE_HEADER);
    try {
      const event = deps.webhook.ingest(rawBody, signature);
      return c.json(ok({ ingested: true, type: event.type, cardId: event.cardId }));
    } catch (err) {
      return c.json(fail(`webhook rejected: ${errMessage(err)}`), 401);
    }
  });
}
