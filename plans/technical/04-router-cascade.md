# Router Cascade (§6)

> **Pure deterministic code.** No LLM, no network I/O. Input: a `MerchantProfile` + a `TaskIntent`.
> Output: a `RoutingDecision`. First match wins, evaluated top to bottom.

## Routing model in one line

You never ask the user anything and you never pre-detect. You attempt the cheapest viable path, and
the merchant's own response tells you where to go next. **Detection is folded into action:** the
existence probe is the *first side effect of the P3 signup attempt*, never a separate step, and it
only runs when guest checkout is unavailable. If guest works, you never probe.

## The cascade

```
STEP 0 — Lane A short-circuit
  if profile.lane == "A":
      → AGENTCARD_BUY   (route TaskIntent to /buy; Agentcard handles acct/PII/card/pay)
      // THIS BUILD: routes to BuyToolRail stub → EXPLAIN_CANT(reason="lane_a_unavailable").
      // account_bound handled inside /buy's connect flow — TO-CONFIRM in docs.
      // stop.

STEP 1 — account-bound check BEFORE terminal rail   ← ORDERING FIX
  // Original plan let terminal_rail win over everything, which silently fails
  // "my usual" / "my credit": a machine rail transacts FRESH and cannot reach the
  // user's existing consumer account. So account_bound must be checked first.
  if intent.account_bound:
      if profile.sso_grant:  → P1   (user authorizes their own account; scoped token)
      else:                  → EXPLAIN_CANT(reason="cant_reach_existing_account",
                                            offer="fresh_order", disclose_whats_lost=true)
      // stop.

STEP 2 — sanctioned machine rail (FRESH transactions only)
  if profile.terminal_rail:  → P0   (pure backend call; zero user-data custody)
                              // vendor is in the self-maintained P0 catalog (§3.5);
                              // pay directly over x402/MPP. No browser, no account, no card. stop.

STEP 3 — no account relationship required → cheapest fulfilling path
  if profile.guest_checkout:        → P2   (guest; existence irrelevant; skip probe)
  elif profile.account_required:
        if profile.forces_3ds:      → EXPLAIN_CANT(reason="3ds_wall")   // Lane B limit
        elif profile.automation_hostility == "high":
              if profile.sso_grant: → P1
              else:                 → P3_ASSISTED   // human-relayed OTP/CAPTCHA
        else:                       → P3   // attempt signup; merchant's response branches you (§7)
  else:
        → EXPLAIN_CANT(reason="no_viable_path")   // dead-corner guard:
                                                  // guest=false & account_required=false
```

## Why the ordering fix matters

The original plan placed `terminal_rail` above the account-bound check. But a terminal/machine rail
(P0) **transacts as a fresh agent** — it has no path to the user's existing consumer account, their
saved order, member pricing, or points. So when the user says "my usual" (`account_bound = true`),
P0 would *silently* produce the wrong result. **Checking `account_bound` first** forces P1 (the user
authorizes their own account) or an honest `EXPLAIN_CANT`. Routing correctness > routing cheapness.

## Dead-corner guards

Two profile states have no viable path and must terminate explicitly, never fall through:
- `account_required == true` + `forces_3ds == true` → `EXPLAIN_CANT(reason="3ds_wall")` (3DS is
  unrecoverable on Lane B — the challenge routes to Agentcard's channel, not the user's).
- `guest_checkout == false` + `account_required == false` → `EXPLAIN_CANT(reason="no_viable_path")`.

## EXPLAIN_CANT is a real terminal

Not a silent degrade. State plainly that the sanctioned door isn't available, **disclose what's lost**
(member price, saved order, points), and offer guest/fresh/abort. When the only way in would require
holding a credential we've decided not to hold, say so and offer P2/P3.

## Self-upgrading property

The router re-derives `lane` and flags from the **current** profile on every run. So:
- A Lane-B `P3`-only merchant becomes `P1` the day it ships SSO.
- It becomes `P0` the day it ships a terminal rail (added to our catalog).
- It graduates to **Lane A** the day Agentcard adds it as a partner.

No rewrite — the cascade just starts matching an earlier, better step.

## Purity & testing

- `route(profile, intent): RoutingDecision` is a pure function — no I/O, no LLM, no Date.now in logic.
- Unit tests enumerate every branch: each `(profile flags × intent.account_bound)` combination
  asserts the expected `path` / `EXPLAIN_CANT.reason`, including both dead-corner guards and the
  ordering-fix case (`account_bound` + `terminal_rail` must yield P1/EXPLAIN_CANT, **not** P0).
