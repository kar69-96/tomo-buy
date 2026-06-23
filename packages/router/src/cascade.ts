import { RoutingDecisionSchema } from '@tomo/core';
import type {
  MerchantProfile,
  TaskIntent,
  RoutingDecision,
  ExplainReason,
  Path,
} from '@tomo/core';

/**
 * Build a non-EXPLAIN_CANT decision immutably.
 */
function decide(
  merchantId: string,
  path: Exclude<Path, 'EXPLAIN_CANT'>,
  reasons: string[],
): RoutingDecision {
  return { path, merchant_id: merchantId, reasons: [...reasons] };
}

/**
 * Build an EXPLAIN_CANT terminal decision immutably. `reason` is recorded in
 * `explain_cant.reason`; `extras` carries the optional honest disclosure
 * (`offer`, `disclose_whats_lost`).
 */
function explainCant(
  merchantId: string,
  reason: string,
  reasons: string[],
  extras: Omit<ExplainReason, 'reason'> = {},
): RoutingDecision {
  return {
    path: 'EXPLAIN_CANT',
    merchant_id: merchantId,
    reasons: [...reasons],
    explain_cant: { reason, ...extras },
  };
}

/**
 * The deterministic router cascade (technical/04-router-cascade.md §6).
 *
 * Pure function: no IO, no LLM, no `Date.now()`. Top-to-bottom, first-match-wins.
 * The critical §6 ordering fix is STEP 1 — `intent.account_bound` is checked
 * BEFORE `profile.terminal_rail` (STEP 2), because a machine/terminal rail
 * transacts FRESH and cannot reach the user's existing account ("my usual").
 * Routing correctness wins over routing cheapness.
 */
function computeDecision(
  profile: MerchantProfile,
  intent: TaskIntent,
): RoutingDecision {
  const id = profile.merchant_id;

  // STEP 0 — Lane A short-circuit. Deferred in this build; the BuyToolRail stub
  // surfaces EXPLAIN_CANT(lane_a_unavailable). account_bound would be handled
  // inside /buy's connect flow once Lane A ships, so Lane A wins first.
  if (profile.lane === 'A') {
    return explainCant(
      id,
      'lane_a_unavailable',
      [
        'Profile is Lane A (Agentcard /buy terminal).',
        'Lane A is deferred in this build: the /buy MCP tool is not yet available, so the BuyToolRail stub returns EXPLAIN_CANT.',
      ],
    );
  }

  // STEP 1 — account-bound check BEFORE the terminal rail (the §6 ordering fix).
  // "my usual" / "my credit" references the user's own existing account; a fresh
  // rail cannot reach it.
  if (intent.account_bound) {
    if (profile.sso_grant) {
      return decide(id, 'P1', [
        'Intent is account-bound (references the user\'s own existing account).',
        'Merchant supports SSO grant; routing to P1 to authorize the user\'s own account via a scoped token.',
      ]);
    }
    return explainCant(
      id,
      'cant_reach_existing_account',
      [
        'Intent is account-bound (references the user\'s own existing account).',
        'Merchant offers no SSO grant, so we cannot reach that account without holding the user\'s credentials.',
      ],
      { offer: 'fresh_order', disclose_whats_lost: true },
    );
  }

  // STEP 2 — sanctioned machine rail. FRESH transactions only; only reached when
  // the intent is NOT account-bound.
  if (profile.terminal_rail) {
    return decide(id, 'P0', [
      'Intent is not account-bound.',
      'Merchant has a terminal (machine) rail in the P0 catalog; routing to P0 for a fresh backend transaction.',
    ]);
  }

  // STEP 3 — no account relationship required → cheapest fulfilling path.
  if (profile.guest_checkout) {
    return decide(id, 'P2', [
      'Intent is not account-bound and merchant is not a terminal rail.',
      'Guest checkout is available; account existence is irrelevant, so we skip the probe and route to P2.',
    ]);
  }

  if (profile.account_required) {
    // Dead-corner: 3DS is unrecoverable on Lane B (the challenge routes to
    // Agentcard's channel, not the user's). No workaround path exists.
    if (profile.forces_3ds) {
      return explainCant(
        id,
        '3ds_wall',
        [
          'Merchant requires an account and forces 3-D Secure.',
          '3DS is unrecoverable on Lane B; the challenge would route to the card channel, not the user. No viable path.',
        ],
      );
    }

    // High automation hostility: never attempt autonomous signup.
    if (profile.automation_hostility === 'high') {
      if (profile.sso_grant) {
        return decide(id, 'P1', [
          'Merchant requires an account with high automation hostility.',
          'SSO grant is available; routing to P1 instead of an autonomous signup attempt.',
        ]);
      }
      return decide(id, 'P3_ASSISTED', [
        'Merchant requires an account with high automation hostility and no SSO grant.',
        'Autonomous signup is unsafe here; routing to P3_ASSISTED for human-relayed OTP/CAPTCHA.',
      ]);
    }

    // Medium/low hostility: attempt autonomous signup; the merchant's response
    // branches the run (detection folded into the P3 attempt).
    return decide(id, 'P3', [
      'Merchant requires an account with low/medium automation hostility.',
      'Routing to P3 for an autonomous signup attempt; the merchant response will branch the run.',
    ]);
  }

  // Dead-corner guard: guest_checkout == false AND account_required == false is a
  // logically impossible/broken profile state. Terminate explicitly, never fall through.
  return explainCant(
    id,
    'no_viable_path',
    [
      'Profile allows neither guest checkout nor declares an account requirement.',
      'This is an impossible/misconfigured profile state with no viable path; terminating explicitly.',
    ],
  );
}

/**
 * `route(profile, intent)` — the public router entrypoint. Validates the computed
 * decision against `RoutingDecisionSchema` at the boundary before returning, so a
 * malformed decision can never leak downstream.
 */
export function route(
  profile: MerchantProfile,
  intent: TaskIntent,
): RoutingDecision {
  return RoutingDecisionSchema.parse(computeDecision(profile, intent));
}
