/**
 * `POST /otp/relay  {workflowId, code}` — record a human-relayed OTP into the
 * api's relay registry. The live P2 workflow never consumes it (a guest order
 * issues no OTP); the channel exists for P3_ASSISTED. Acknowledged honestly as
 * wired-but-unused on P2.
 */
import type { Hono } from 'hono';
import { ok, fail, errMessage } from '../http.js';
import { OtpRequestSchema } from '../schemas.js';
import type { AppDeps } from '../app-deps.js';

export function registerOtpRoute(app: Hono, deps: AppDeps): void {
  app.post('/otp/relay', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = OtpRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(fail(`invalid /otp/relay body: ${parsed.error.message}`), 400);

    if (!deps.store.has(parsed.data.workflowId)) {
      return c.json(fail(`unknown workflow '${parsed.data.workflowId}'`), 404);
    }

    try {
      deps.otp.relay(parsed.data.workflowId, parsed.data.code);
    } catch (err) {
      return c.json(fail(errMessage(err)), 400);
    }

    return c.json(
      ok({
        workflowId: parsed.data.workflowId,
        relayed: true,
        note: 'P2 guest checkout consumes no OTP; channel is ready for P3_ASSISTED.',
      }),
    );
  });
}
