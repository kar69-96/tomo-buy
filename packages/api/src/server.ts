/**
 * `createApp(deps)` — the Hono application: the §14 service contracts plus the
 * `GET /` portal. Pure wiring over injected ports, so every route is unit-testable
 * in-process via `app.request(...)` and the one Temporal integration test is the
 * only test that needs a live dev server.
 */
import { Hono } from 'hono';
import { renderPortal } from './portal/page.js';
import { registerIntentRoute } from './routes/intent.js';
import { registerRouteRoute } from './routes/route.js';
import { registerExecuteRoute } from './routes/execute.js';
import { registerApprovalRoute } from './routes/approval.js';
import { registerOtpRoute } from './routes/otp.js';
import { registerWebhookRoute } from './routes/webhook.js';
import { registerWorkflowRoute } from './routes/workflow.js';
import type { AppDeps } from './app-deps.js';

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Health + portal.
  app.get('/healthz', (c) => c.json({ success: true, data: { ok: true } }));
  app.get('/', (c) => c.html(renderPortal()));

  // §14 service contracts.
  registerIntentRoute(app, deps);
  registerRouteRoute(app, deps);
  registerExecuteRoute(app, deps);
  registerApprovalRoute(app, deps);
  registerOtpRoute(app, deps);
  registerWebhookRoute(app, deps);
  registerWorkflowRoute(app, deps);

  return app;
}
