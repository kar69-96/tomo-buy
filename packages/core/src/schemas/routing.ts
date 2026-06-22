import { z } from 'zod';

/**
 * Path — the routing cascade's terminal decisions. Includes `EXPLAIN_CANT` as a
 * member (per phase-00 runbook), which equals spec §6's `Path | "EXPLAIN_CANT"`.
 *
 *  - AGENTCARD_BUY : Lane A terminal /buy (deferred; stubbed → EXPLAIN_CANT for now)
 *  - P0            : machine rail (x402/MPP) against a self-catalog vendor (deferred)
 *  - P1            : SSO-granted scoped token path
 *  - P2            : guest checkout (the live slice in this build)
 *  - P3            : autonomous account signup + checkout
 *  - P3_ASSISTED   : human-relayed OTP/CAPTCHA
 *  - EXPLAIN_CANT  : cannot proceed; explain what's lost and offer an alternative
 */
export const PathSchema = z.enum([
  'P0',
  'P1',
  'P2',
  'P3',
  'P3_ASSISTED',
  'AGENTCARD_BUY',
  'EXPLAIN_CANT',
]);

/**
 * Detail attached when the decision is EXPLAIN_CANT. Field name is `explain_cant`
 * (spec §6 full field list), not the runbook's shorthand `explain`.
 */
export const ExplainReasonSchema = z.object({
  reason: z.string().min(1),
  offer: z.string().optional(),
  disclose_whats_lost: z.boolean().optional(),
});

/** RoutingDecision (§6) — the cascade's output, validated at the boundary. */
export const RoutingDecisionSchema = z.object({
  path: PathSchema,
  merchant_id: z.string().min(1),
  reasons: z.array(z.string()),
  explain_cant: ExplainReasonSchema.optional(),
});

export type Path = z.infer<typeof PathSchema>;
export type ExplainReason = z.infer<typeof ExplainReasonSchema>;
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
