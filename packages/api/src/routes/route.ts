/** `POST /route  TaskIntent → RoutingDecision` — `@tomo/profiles` getProfile + `@tomo/router` route. */
import type { Hono } from 'hono';
import { route } from '@tomo/router';
import { ok, fail } from '../http.js';
import { RouteRequestSchema } from '../schemas.js';
import type { AppDeps } from '../app-deps.js';

export function registerRouteRoute(app: Hono, deps: AppDeps): void {
  app.post('/route', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = RouteRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(fail(`invalid /route body: ${parsed.error.message}`), 400);

    const profile = deps.getProfile(parsed.data.merchant_id);
    if (!profile) {
      return c.json(fail(`unknown merchant '${parsed.data.merchant_id}'`), 404);
    }

    const decision = route(profile, parsed.data);
    return c.json(ok(decision));
  });
}
