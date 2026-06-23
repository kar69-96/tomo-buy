# Phase-02 Build Report — Intent Parser + Deterministic Router + Seed Profiles

**Phase:** phase-02 · **Wave:** 2 · **Branch:** `feat/phase-02` · **Status:** ✅ DoD green

## What was built

Replaced the three Wave-2 stub packages with working, tested implementations. All
logic consumes the frozen `@tomo/core` contracts; nothing in core was changed.

### `packages/router/` — deterministic §6 cascade
- `src/cascade.ts` — `route(profile, intent): RoutingDecision`. **Pure** (no IO, no LLM,
  no clock), top-to-bottom first-match. Implements the §6 order exactly, **including the
  ordering fix**: `intent.account_bound` (STEP 1) is checked **before** `profile.terminal_rail`
  (STEP 2), so "my usual"/"my credit" can never silently route to a fresh P0 rail.
  - STEP 0 Lane A → `EXPLAIN_CANT(lane_a_unavailable)` (BuyToolRail stub era).
  - STEP 1 account_bound → `P1` (if `sso_grant`) else `EXPLAIN_CANT(cant_reach_existing_account,
    offer:"fresh_order", disclose_whats_lost:true)`.
  - STEP 2 terminal_rail (not account-bound) → `P0`.
  - STEP 3 `guest_checkout` → `P2`; `account_required` + `forces_3ds` →
    `EXPLAIN_CANT(3ds_wall)`; `account_required` + hostility `high` → `P1`/`P3_ASSISTED`;
    else → `P3`; final dead-corner (`!guest && !account_required`) →
    `EXPLAIN_CANT(no_viable_path)`.
  - Every branch records human-readable `reasons[]`; output validated against
    `RoutingDecisionSchema` at the boundary.

### `packages/profiles/` — seed data + repository
- `src/seed/*.ts` — 3 `MerchantProfile`s + 1 `P0VendorCatalogEntry`, all schema-valid,
  with fixed ISO timestamps (deterministic, no `Date.now()`):
  - `guest-goods-co` (`guest_checkout:true`, Lane B) → exercises P2.
  - `agentcard-partner-eats` (`lane:"A"`) → exercises the Lane A stub.
  - `members-only-grocer` (`account_required:true`, no SSO, no 3DS) → exercises P3 /
    EXPLAIN_CANT.
  - `mpp-coffee-roaster` — one P0 catalog entry.
- `src/repository.ts` — `getProfile(merchantId)` / `getP0Vendor(vendorId)` over a static
  `Map`, each returning a **frozen deep copy** (immutability: the backing store can never
  be mutated by a caller).

### `packages/intent/` — intent-only LLM parser
- `src/parse.ts` — `parseIntent(userId, text, deps?)`. The model client is **injected**
  (`deps.complete`), defaulting to the real OpenRouter call, so tests run with no network.
  The model extracts only `merchant_id`, `cart_spec`, and `price_ceiling_cents`; the
  safety-critical `account_bound` flag and the `ship_to_ref` reference are derived
  **trusted-side**, never from the model. Raw model output is validated by a `.strict()`
  schema (a sneaked `path`/`lane` field hard-fails), and the final object is validated
  against `TaskIntentSchema` before return. Returns `{ intent, ceilingDefaulted }`.
- `src/prompt.ts` — strict system prompt: extract intent only; never a path/lane; never a
  secret/PAN/password/address; money in integer cents.
- `src/provider.ts` — default OpenRouter completion over native `fetch`, env-driven
  (`OPENROUTER_API_KEY`, `INTENT_MODEL`). Network-only; excluded from coverage.

## Test results & coverage

`pnpm build` ✅ (12/12) · `pnpm test` ✅ (full workspace) · `typecheck` ✅ (all 3 owned pkgs)

| Package          | Tests | Lines | Branches | Funcs | Stmts |
|------------------|------:|------:|---------:|------:|------:|
| `@tomo/router`   |    18 |  100% |     100% |  100% |  100% |
| `@tomo/profiles` |    12 |  100% |     100% |  100% |  100% |
| `@tomo/intent`   |    22 |  100% |     100% |  100% |  100% |

DoD behavioral checks, all asserted by unit tests:
- ✅ Router covers every §6 branch, incl. the **ordering fix** (account_bound + terminal_rail
  → P1/EXPLAIN_CANT, never P0) and **both dead-corner guards** (`3ds_wall`, `no_viable_path`).
- ✅ Lane A profile → `EXPLAIN_CANT(lane_a_unavailable)`.
- ✅ Parser returns only a schema-valid `TaskIntent`, never a path/lane; ceiling default is
  flagged via `ceilingDefaulted`.
- ✅ Prime directive: no PAN/CVV/password/vault field/token in model context or logs; parser
  output carries references only (`ship_to_ref` is a Vault B pointer, addresses never enter
  model context).

## Deviations from the runbook (honest)

1. **Model provider — OpenRouter, not Vercel AI Gateway.** The runbook names the Vercel AI
   Gateway with an `"anthropic/claude-…"` model string. Per an explicit decision with the
   user, this uses **OpenRouter** with a cheap, env-configurable model
   (`OPENROUTER_API_KEY`, `INTENT_MODEL`; user will paste `.env` later). Implemented over
   native `fetch` with no `ai`-SDK dependency, which also sidesteps the zod-3/zod-4 peer
   conflict noted as a risk. Swapping providers later is a one-file change in `provider.ts`.

2. **`parseIntent` return type.** The runbook sketches `Promise<TaskIntent>`; the
   implementation returns `Promise<{ intent: TaskIntent; ceilingDefaulted: boolean }>` so the
   conservative-default flag the runbook requires ("missing ceiling yields the default + a
   marker") has a home. `TaskIntentSchema` has no field for the flag, so it rides alongside.

3. **Default price ceiling = `5000` cents ($50).** Chosen with the user (the runbook left the
   value to implementation). Applied only when the user names no price, and always flagged.

4. **`account_bound` derived trusted-side.** Rather than trusting the model to set it, the flag
   is computed deterministically from the original user text via a phrase matcher — defense in
   depth for a safety-critical routing input, consistent with "re-validate every model-emitted
   parameter."

## Files outside owned dirs

- `pnpm-lock.yaml` (root) — regenerated by `pnpm install` after adding `@vitest/coverage-v8`
  (dev) to all three packages and `zod` (runtime) to `@tomo/intent`. This is the unavoidable
  generated consequence of declaring dependencies in the owned packages; no other root config
  or package was touched.
- `plans/build-plans/reports/phase-02-report.md` — this report (required by CONVENTIONS §5).

## Known gaps / follow-ups

- P0 (machine rail) and Lane A `/buy` remain deferred; the seeds and routes for them are in
  place but their execution lands in later phases. Lane A correctly stubs to EXPLAIN_CANT.
- The OpenRouter call path (`provider.ts`) is not exercised by a live integration test (no key
  in CI); it is covered structurally and excluded from unit coverage by design.
