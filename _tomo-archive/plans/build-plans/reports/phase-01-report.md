# Phase 01 Report — Agentcard Rail (M0) + x402 Port

- **Wave:** 2
- **Branch / PR:** `feat/phase-01` → (PR opened against `main`, label `wave-2`)
- **Owned packages:** `packages/funding/`, `packages/rails-x402/`
- **Date:** 2026-06-22
- **Result:** ⚠️ complete-with-gaps (one gap: live sandbox run not yet verified — no `sk_test_` key)

## What was built

### `@tomo/funding` — `AgentcardRail` (M0)
- **`src/agentcard/client.ts`** — `AgentcardClient`: thin HTTP client for the documented Agentcard
  REST API (base `https://api.agentcard.sh`, `Authorization: Bearer`, `Content-Type: application/json`,
  **cents** everywhere). One `request()` helper maps every non-2xx to a typed
  `AgentcardError extends FundingError` carrying the HTTP status and parsed body; **422 attaches
  `setupUrl`**. Methods cover the full documented endpoint table (cardholders, payment-method
  setup/status, cards create/details/close/list, webhook_endpoints). `fetch` is injectable so tests
  never hit the network. Request/response bodies are **never logged** (PAN/CVV could be present).
- **`src/agentcard/agentcard-rail.ts`** — `AgentcardRail implements FundingRail`:
  - `issueCard` **guards cents before any network call**: integer, `100 ≤ amountCents ≤ 5000`;
    rejects `> 5000` (org $50/card ceiling) and `< 100` with `FundingError`.
  - `ensureCardholder` treats **409 duplicate email** as "exists, reuse".
  - `getCardSecret` returns only `{ pan, cvv, expiry }` (SECRET-FLOW — Executor path only).
  - `closeCard` idempotent (404 ⇒ already-closed ⇒ success).
  - `listTransactions` projects the webhook event store into `Txn[]`.
- **`src/agentcard/event-store.ts`** — `WebhookEventStore`: append-only, keyed by card id, immutable
  reads (returns fresh arrays). The §8 reconciliation source of truth.
- **`src/agentcard/webhooks.ts`** — `verifyAndIngest` / `verifySignature`: recompute HMAC-SHA256 over
  the raw body with the `whsec_` secret, **constant-time compare** (`crypto.timingSafeEqual`) against
  `AgentCard-Signature`; reject bad signature / missing header / non-JSON / schema-invalid payloads;
  append verified `ChargeEvent`s to the store. Supports Stripe-style `t=,v1=` and bare-hex headers.
- **`src/buy-tool/buy-tool-rail-stub.ts`** — `BuyToolRail implements FundingRail`. Lane A `/buy` is
  not in the public docs, so every method fails closed with `LaneAUnavailableError` (a `FundingError`
  carrying the core `ExplainReason` `EXPLAIN_CANT(lane_a_unavailable)`).
- **`scripts/verify-sandbox.ts`** — manual M0 acceptance gate (hold → capture → release); logs every
  step with **no secrets** (last4 only). README documents how to run it.

### `@tomo/rails-x402` — x402 client port (compile + test; P0 wiring deferred)
- Ported from AgentPay unchanged where possible: `client/types.ts`, `client/payment-handler.ts`
  (EIP-3009/USDC/Base), `client/wallet.ts`, `client/x402-client.ts` (`x402Fetch`),
  `router/payment-router.ts` (`routePayment`). Two lines adapted for the stricter workspace
  `noUncheckedIndexedAccess`.
- `src/index.ts` — `X402Rail implements MachineRail`; `pay`/`setControls` throw `NotImplementedError`
  (P0 settlement + catalog + wallet are wired in **phase-10**). Re-exports the ported helpers.
- Added `viem` dependency.

## Test results
- Command: `pnpm test --filter @tomo/funding --filter @tomo/rails-x402`
- Suites: **10/10** pass (funding 5, rails-x402 5).  Tests: **86/86** pass (funding 48, rails-x402 38).
- Coverage (lines): **funding 97.7%**, **rails-x402 94.4%**  (target ≥ 80%; thresholds enforced in
  each package's `vitest.config.ts`).
- Build: `pnpm build` ✅ (12/12 packages).  Typecheck: ✅ both owned packages.

## Failures & known gaps (honest)
| Item | Severity | Why it failed / what's missing | Triaged to |
|---|---|---|---|
| Live sandbox hold→capture→release | medium | No `sk_test_*` key available in this environment; `scripts/verify-sandbox.ts` is written + documented but **not yet executed against the sandbox**. | Run when a sandbox key is provisioned (M0 sign-off) |
| `X402Rail.pay` / `setControls` | low (by design) | P0 settlement, catalog, and self-held wallet are out of scope for this phase. Methods throw `NotImplementedError`. | phase-10 (deferred) |
| `BuyToolRail` (Lane A `/buy`) | low (by design) | `/buy` MCP tool not in public docs. Stub fails closed with `EXPLAIN_CANT(lane_a_unavailable)`. | phase-06 |
| `getUSDCBalanceOnChain` not unit-covered | low | Thin viem RPC wrapper against a live Base node; `/* c8 ignore */` with a note. | phase-10 e2e |
| Webhook signature header exact format | low | Public docs describe a "timestamped `AgentCard-Signature`" but not the precise encoding; implemented Stripe-style `t=,v1=` + bare-hex fallback. | Re-confirm vs `docs.agentcard.sh` before live |

Failure-triage checklist:
- [x] Every skipped/uncovered path is listed above with a reason.
- [x] Every stub / deferred method left in owned code is listed.
- [x] "Works locally but not in sandbox" (the live M0 run) is called out.
- [x] No secret leaked into logs/LLM context — `getCardSecret` is asserted never-logged across all
  `console` channels; no `console.*` in production source; client never logs bodies.

## Deviations from the plan
- Added `@vitest/coverage-v8` devDep + coverage config to both owned packages (the plan anticipated
  this; thresholds: lines 80 enforced).
- Adapted two lines in the ported `payment-handler.ts` for the stricter workspace tsconfig
  (`noUncheckedIndexedAccess`) — "unchanged where possible" allowed minimal import/strictness fixes.
- Added focused unit tests (wallet, EIP-3009 signing, private-key paid path, base64 v2 requirements)
  so the ported package clears the 80% bar honestly rather than by lowering the threshold.

## Follow-ups
- Provision a `sk_test_` sandbox key and run `verify-sandbox.ts` to close the M0 gate.
- Re-confirm the webhook signature encoding against `https://docs.agentcard.sh/integration-guide`.
- phase-06: real Lane A `/buy`. phase-10: wire `X402Rail` (routing + catalog + settlement wallet).

## Open-decision (§15) items touched
- `listTransactions` is a **webhook-event-store adapter** (no documented list endpoint) — TO-CONFIRM;
  swap implementation if Agentcard later ships a list-transactions endpoint.
- Per-card **$50 ceiling** ($5000 cents) enforced at the rail; raising it requires Agentcard support.
- P0 **settlement-wallet custody** choice remains an open decision (`plans/spec/02-open-decisions.md`).
- §15 money-transmitter posture: this system never custodies funds or PANs (Agentcard holds PCI
  scope + funding relationship); the rail handles references and flags only.

## Sign-off
- [x] Definition of Done in the phase file met (except the live-sandbox run — provisioning-blocked,
  documented above).
- [x] Report is accurate and honest about what didn't work.
