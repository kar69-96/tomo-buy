# Phase-05 Report — Live Lane B P2 guest-checkout slice (integration)

| | |
|---|---|
| **Wave** | 3 (SOLO — integrates all of Wave 2) |
| **Branch / PR** | `feat/phase-05` → `main` (label `wave-3`) |
| **Owned packages** | `packages/api/`, `apps/ui/` |
| **Date** | 2026-06-22 |
| **Result** | ⚠️ complete-with-gaps — full slice runs end-to-end to a reconciled `SETTLED` in an in-memory Temporal env; **the live Agentcard-sandbox run is pending credentials** (documented below) |

---

## What was built

The §14 service contracts + the Lane B P2 composition root, wiring every merged Wave-2 package into
one guest-checkout flow behind our human approval gate.

**`packages/api/` (`@tomo/api`)** — a Hono service (chosen because the repo had no HTTP framework;
in-process `app.request()` testing keeps the suite socket-free):

- **The 7 §14 endpoints** (`src/routes/*.ts`, thin handlers over injected ports, Zod-validated at every
  boundary):
  - `POST /intent` → `@tomo/intent` `parseIntent` (intent-only) → `TaskIntent`.
  - `POST /route` → `@tomo/profiles` `getProfile` + `@tomo/router` `route` → `RoutingDecision`.
  - `POST /execute` → starts the Temporal `checkout` workflow (P2 only; refuses other paths 422).
  - `POST /approval/resolve` → our approval gate: signs an Ed25519 mandate binding the exact cart +
    approved total, signals `approve`/`reject`.
  - `POST /otp/relay` → records a human-relayed OTP (see gap #2).
  - `POST /webhook` → verifies the `whsec_` signature (reuses `@tomo/funding` `verifyAndIngest`) and
    appends to the shared event store (reconciliation source of truth); bad signature → 401.
  - `GET /workflow/:id` → joins the persisted record with the live Temporal status query (secret-free).
- **Composition** (`composition.ts` + `checkout-deps.ts`): assembles the orchestrator `CheckoutDeps`
  from `AgentcardRail` (issue/close/listTransactions/getCardSecret), a real **Vault B**, and the
  trusted-side **`Executor`** over **headless Chrome** (`PlaywrightDriver`). `getCardSecret` flows only
  into the executor's page-fill path — never returned, never logged.
- **Trusted-side mandate signer** (`mandate-signer.ts`), **in-memory workflow store** (the api keeps
  the original `TaskIntent` to rebuild the mandate at approval time), **OTP relay registry**, **Temporal
  client adapter**, **config loader** (fail-fast on missing secrets), and **`startServer`** (boots an
  in-process worker + client + serves the portal).
- **The portal** (`portal/page.ts`, served at `GET /`): prompt → routed plan + cart + total →
  approve / reject + OTP relay. No secret-bearing input fields by construction.

**`apps/ui/` (`@tomo/ui`)** — a thin launcher (`startUi`) that boots the `@tomo/api` server and prints
the portal URL (the portal is api-served, per the locked UI decision). `start` is injectable so it is
unit-testable without a live environment.

---

## Test results + coverage

```
pnpm build      → 12/12 tasks ✓
pnpm typecheck  → 22/22 tasks ✓ (tsc --noEmit, strict)
pnpm test       → 22/22 tasks ✓
```

| Package | Tests | Lines | Branch | Funcs | Stmts |
|---|---|---|---|---|---|
| `@tomo/api` | 63 | **97.95%** | 97.08% | 97.61% | 97.95% |
| `@tomo/ui` | 3 | **100%** | 100% | 100% | 100% |

Both exceed the 80% threshold (enforced in each `vitest.config.ts`). Integration glue exercised only by
the live run (`start.ts`, `start-server.ts`, `composition.ts`, `start-ui.ts`) is `/* v8 ignore */`'d /
coverage-excluded with a comment.

**Headline test — `src/server.integration.test.ts`** (runs against a REAL Temporal dev server via
`TestWorkflowEnvironment.createLocal()`, no time-skipping): drives
`text → /intent → /route(P2) → /execute → AWAITING_APPROVAL → /approval/resolve(approve) →
issueCard → placeOrder (real Executor + atomic PAN swap over a mock checkout form) → /webhook
(transaction.authorized) → reconcile → **SETTLED**`. It then asserts:
- the distinctive PAN/CVV/PII fixtures appear **only** in the in-page swap map, **never** in the agent
  transcript or the server logs (the prime-directive grep), and
- the final reconciled state is `SETTLED`.

---

## Failures & known gaps (honest)

| Item | Severity | Why / what's missing | Triaged to |
|---|---|---|---|
| **Live Agentcard-sandbox P2 run not executed** | high | No `sk_test_` / webhook secret / guest-checkout test merchant available yet (user: "no creds yet, can get as necessary"). The full slice is proven against an in-memory Temporal env + real Vault B + real Executor; the *live* card issue→PAN-inject→settle round-trip is one command away once creds land (below). DoD explicitly permits documenting this as the blocker. | live run when creds land |
| **OTP relay wired-but-unused on P2** | medium | The P2 workflow defines no OTP signal (a guest order issues none) and phase-05 may not edit the orchestrator. `/otp/relay` records the code in an api-owned registry — a real channel ready for `P3_ASSISTED` `relayOtp` — but the P2 happy path never consumes it. | P3_ASSISTED phase |
| **`revalidate` / `findMerchantOrder` are thin probes** | medium | `revalidate` echoes the ceiling + `inStock:true`; `findMerchantOrder` returns `false`. A real price/inventory scrape + merchant order-state probe is a follow-up; the workflow's hard guardrails (`amount ≤ ceiling/cap`, merchant match) and the webhook event store still gate the charge. | follow-up |
| **Webhook latency vs immediate reconcile** | medium | The phase-04 workflow reconciles right after `placeOrder` with no wait-for-webhook. The slice models "order placed ⇒ Agentcard authorizes ⇒ webhook delivered" by posting the signed webhook synchronously inside `placeOrder`, so recon sees the charge → `SETTLED`. In a *live* run, if the `transaction.authorized` webhook lags the reconcile, recon would see "card spent, no charge" → `ABANDONED` (fail-closed, no double charge). A wait-for-webhook step belongs in the orchestrator (not api). | orchestrator follow-up |
| **Live cart-building navigation not implemented** | medium | `Executor.checkout` assumes the driver is already on the merchant checkout FORM; navigating an arbitrary live merchant to build the guest cart is out of scope. The slice/integration test uses a mock checkout form. | follow-up |
| **Card `last4` not surfaced** | low | `CardRef` deliberately carries no `last4` (the PAN/details are the secret path we must not open for a display nicety). The portal shows merchant + cart + total + status + workflowId instead. | accepted |
| **`.env.example` not updated** | low | New live vars (`WEBHOOK_SECRET`, `MANDATE_PASSPHRASE`) belong in the root `.env.example`, which is outside the owned dirs. Listed here + in `config.ts` instead. | doc follow-up |

Failure-triage checklist:
- [x] Every failing/skipped test listed — there are none failing; the live run is the documented blocker.
- [x] Every stub/`TODO` in owned code listed (revalidate, findMerchantOrder, OTP-on-P2).
- [x] "works locally but not in sandbox" called out — the live run is pending creds.
- [x] No secret in logs/LLM context — asserted by the integration grep + reviewed (no `getCardSecret`/PAN
      in any route or the portal).

## How to run the live slice (one command, when creds land)

```bash
temporal server start-dev &
export AGENTCARD_API_KEY=sk_test_…       # Agentcard sandbox org key
export WEBHOOK_SECRET=whsec_…            # from POST /api/v1/webhook_endpoints
export VAULT_MASTER_KEY=…  MANDATE_PASSPHRASE=…
# wire a real LLM `complete` into startServer/startUi for /intent
pnpm --filter @tomo/ui start            # boots api + worker, serves the portal; drive a guest-checkout test merchant
```

## Deviations from the plan

- **HTTP framework = Hono** (the repo had none) — locked with the user.
- **Headless Chrome, not Browserbase** — user-directed; the executor's `PlaywrightDriver` already drives
  local headless Chrome, so this required no new code.
- **Portal served by api; `apps/ui` is a launcher** — locked UI decision.
- **last4 not surfaced** (see gaps) — a conscious secret-flow-preserving choice.

## Follow-ups

- Execute the live Agentcard-sandbox P2 run and capture the trace (states + reconciled receipt).
- Orchestrator: add a wait-for-webhook step before reconcile so a lagging `transaction.authorized` does
  not fail-closed to `ABANDONED` on the live path.
- Replace the thin `revalidate` / `findMerchantOrder` probes with real scrapes; add live cart-building
  navigation; wire `P3_ASSISTED` to consume the OTP relay channel.
- Add `WEBHOOK_SECRET` / `MANDATE_PASSPHRASE` to the root `.env.example`.

## Open-decision (§15) items touched

- Confirms the approval gate is **ours, not an Agentcard `202`** — the api signs the mandate; the
  workflow verifies it before issuing a card.
- Exercises the **single-use card as a deliberate fail-closed backstop** (a lagging webhook abandons
  rather than double-charges).

## Sign-off

- [x] All 7 §14 endpoints implemented; UI can approve + relay OTP.
- [x] `pnpm build && pnpm test` green (22/22 tasks); coverage ≥ 80% on `@tomo/api` (97.95%) and `@tomo/ui` (100%).
- [x] Happy-path integration test reaches `SETTLED`; no secret in transcript/logs (grep asserted).
- [ ] **Live sandbox P2 run** — pending credentials (documented above with exact env + command).
- [x] Final workflow state reconciled; hold released/captured correctly (recon → `SETTLED`).
- [x] Report committed and used as the PR body; honest about the live-run gap.
