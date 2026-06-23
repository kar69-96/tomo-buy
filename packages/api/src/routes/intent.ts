/** `POST /intent  {userId,text} → ParseResult` — calls `@tomo/intent` parseIntent (intent-only). */
import type { Hono } from 'hono';
import { parseIntent } from '@tomo/intent';
import { ok, fail, errMessage } from '../http.js';
import { IntentRequestSchema } from '../schemas.js';
import type { AppDeps } from '../app-deps.js';

export function registerIntentRoute(app: Hono, deps: AppDeps): void {
  app.post('/intent', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = IntentRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(fail(`invalid /intent body: ${parsed.error.message}`), 400);

    try {
      const result = await parseIntent(parsed.data.userId, parsed.data.text, {
        complete: deps.complete,
      });
      return c.json(ok(result));
    } catch (err) {
      return c.json(fail(`intent parse failed: ${errMessage(err)}`), 502);
    }
  });
}
