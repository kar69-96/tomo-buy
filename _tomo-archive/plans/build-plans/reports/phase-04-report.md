# Phase-04 Build Report — Temporal Approval/Recon/Orphan State Machine

| | |
|---|---|
| **Wave** | 2 (parallel with phase-01/02/03) |
| **Branch / PR** | `feat/phase-04` → `main` (label `wave-2`) |
| **Owned packages** | `packages/orchestrator/`, `apps/worker/` |
| **Date** | 2026-06-22 |
| **Result** | ✅ PASS — build + typecheck green, 70 tests pass, coverage ≥ 80% on both packages |

---

## What was built

The §8 checkout state machine on Temporal (free local `temporal server start-dev`), with
idempotency-under-partial-failure as the central guarantee.

**`packages/orchestrator/` (`@tomo/orchestrator`)**

- **`sm/states.ts`** — the state set + allowed transition table:
  `CART_BUILT → AWAITING_APPROVAL → CARD_ISSUED → CHARGE_PENDING → {SETTLED | DECLINED | ABANDONED | NEEDS_RECON}`.
  `canTransition`/`isTerminal` are pure.
- **`sm/reducer.ts`** — pure `reduce(status, event)`; every workflow transition routes through it,
  so illegal moves throw `ReconciliationError` rather than silently no-op'ing.
- **`recon.ts`** — `decideRecon(...)`, the double-charge brain. Charge present in the event store →
  `SETTLED` (never re-place); explicit decline → `DECLINED`; no charge + card spent → `ABANDONED`
  (fail-closed); no charge + card unused + merchant shows an order → `NEEDS_RECON`; no charge + card
  unused + no order → `RETRY_ONCE` within budget, else `ABANDONED`.
- **`guards.ts`** — `validateChargeParams`: re-validates model-emitted params at the approval gate
  (`amount ≤ price_ceiling`, `amount ≤ $50 cap`, `merchant == routed merchant`).
- **`mandate.ts`** — faithful port of AgentPay `auth/mandate.ts` + `keypair.ts` to **`node:crypto`**
  Ed25519 (zero new crypto deps). `ApprovalDetails` binds the mandate to merchant + approved cents +
  `intentHash` (SHA-256 of the canonical `TaskIntent`) + timestamp, so a mandate is replay-resistant
  and cannot be reused for a different cart/amount. `isMandateFresh` adds a time-window check.
- **`activities/index.ts`** — `createActivities(deps)` factory over a `CheckoutDeps` seam (Wave-3 / tests
  inject the concrete FundingRail / Executor / event store): `surfaceApproval`, `verifyApproval`
  (the only place crypto runs), `issueCard`, `placeOrder` (flag only), `reconcile`, `closeCard`,
  `enqueueAccountClaim`, plus fail-closed `getCardSecret`/`relayOtp`.
- **`workflow/checkout.ts`** — the durable workflow. The human approval gate is **ours** (a Temporal
  `condition(..., T_approve)` timer + `approve`/`reject` signal, **not** an Agentcard `202`). On
  approval it re-validates price+inventory, runs guardrails, verifies the signed mandate (in an
  activity), issues a single-use card for the **approved** total, then places the order and
  **reconciles before any retry**. `placeOrder`/`issueCard` use `maximumAttempts: 1` so Temporal never
  silently re-runs a possibly-successful order. Orphan cleanup always `closeCard`s on ABANDONED/DECLINED
  and enqueues an account-claim for P3 (`account_bound`) intents.

**`apps/worker/` (`@tomo/worker`)**

- **`worker.ts`** — `buildWorker`/`startWorker`; registers the `checkout` workflow (from the pre-built
  `@tomo/orchestrator/workflow` bundle — real `.js`, so the worker bundler never trips over TS `.js`
  specifiers) + activities, against `localhost:7233`.
- **`stub-deps.ts`** — fail-closed default `CheckoutDeps` so the worker can boot before Wave-3 (side
  effects throw `NotImplementedError`; reads report "nothing happened" so recon can never falsely settle).

---

## Test results + coverage

```
pnpm build           → 12/12 tasks ✓
pnpm typecheck       → orchestrator + worker ✓ (tsc --noEmit, strict)
pnpm test --filter @tomo/orchestrator --filter @tomo/worker → 70 tests pass
```

| Package | Tests | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|---|
| `@tomo/orchestrator` | 64 | 99.21% | 97.46% | 100% | 99.21% |
| `@tomo/worker` | 6 | 100% | 93.33% | 100% | 100% |

Both exceed the 80% threshold on every metric (enforced in each `vitest.config.ts`).

**The headline test — "order placed but confirmation read failed → NO double charge":**
`workflow/checkout.test.ts` drives the real workflow on a live dev server with `placeOrder` throwing
(confirmation read failed) while the webhook event store holds the `transaction.authorized`. The
workflow reconciles, resolves to **SETTLED**, and asserts `placeOrder` was called **exactly once**.
The same property is unit-tested directly in `recon.test.ts`.

Other live-server tests: happy path → SETTLED; `T_approve` timeout → ABANDONED + account-claim
enqueued; abandoned-after-charge → `closeCard` releases the hold; invalid/forged mandate → ABANDONED.
`apps/worker/worker.test.ts` boots the worker against a real dev server (injected + self-opened
connections) and runs a checkout end-to-end.

---

## Failures / known gaps (honest)

| Item | Severity | Why | Triaged to |
|---|---|---|---|
| `getCardSecret`, `placeOrder` are stubs | expected | The trusted-side Executor + PAN injection is Wave-3 by design. They return flags / throw `NotImplementedError`; **no PAN ever enters workflow or test context**. | Wave-3 |
| Webhook event store is an injected seam, not a live endpoint | expected | `POST /api/v1/webhook_endpoints` + `whsec_` signature verification is **phase-05**. Phase-04 consumes the store via `deps.getEvents` so the recon logic is testable now. | phase-05 |
| `relayOtp` not implemented | expected | OTP relay arrives with the email architecture. | phase-05 |
| Lane A `/buy` | deferred | Out of this build's scope per `spec/01-reality-reconciliation.md`. | — |
| `src/workflow/checkout.ts` excluded from v8 coverage | accepted | The workflow runs from the bundled `dist/workflow.js` inside Temporal's sandbox isolate, which v8 can't instrument from source. Its behaviour is covered by the 5 live-server integration tests, not by the % number. Documented in `vitest.config.ts`. | — |
| `pnpm-lock.yaml` modified | unavoidable | Adding the `@temporalio/*` SDK touches the root lockfile (the one shared file outside the owned dirs). No source files outside `packages/orchestrator/` and `apps/worker/` were changed. | — |

---

## Deviations from the plan

- **Test infra (per the locked decision "require a live dev server"):** used
  `@temporalio/testing` `TestWorkflowEnvironment.createLocal()` — a **real** dev server with **no
  time-skipping** — for workflow/worker integration tests. `T_approve` was made a workflow argument so
  the timeout test fires in ~0.8 s against the real timer (production default stays 15 min). Installed
  the Temporal CLI (`brew install temporal`, v1.7.2) to provide the server.
- **Mandate shape:** adapted AgentPay's `TransactionDetails`→`ApprovalDetails` (cents, plus `intentHash`)
  to bind approvals to the exact cart; signing/verifying stays the faithful `node:crypto` Ed25519 port.
- **Added a `./workflow` export subpath + tsup entry** on `@tomo/orchestrator` so the worker and the
  integration test register the workflow from a real `.js` bundle (avoids the TS `.js`-extension
  bundling pitfall) — runs in the Temporal sandbox cleanly.
- Node 25 in this environment; `@temporalio/*` requires Node ≥ 20 — fine.

---

## Follow-ups

- **Wave-3:** inject the concrete `CheckoutDeps` — Agentcard `FundingRail` (`issueCard`/`closeCard`/
  `listTransactions`), Browserbase Executor for `placeOrder` + `getCardSecret` (trusted-side PAN
  injection), merchant order-state probe, and the account-claim queue.
- **phase-05:** webhook endpoint registration + `whsec_` signature verification feeding `getEvents`;
  OTP relay for `relayOtp`.
- Consider persisting/keying approval mandates to an audit store when the API gateway lands.

## Open-decision items touched

- Confirms the approval gate is **ours, not an Agentcard `202`** (per `spec/01-reality-reconciliation.md`)
  — implemented as a first-class Temporal state, not an error path.
- Exercises the **single-use card as a deliberate fail-closed backstop** (retry against a spent card is
  abandoned by construction) rather than discovering it by accident.

## Sign-off — Definition of Done

- [x] `pnpm build && pnpm test --filter @tomo/orchestrator --filter @tomo/worker` green
- [x] Coverage ≥ 80% on both packages
- [x] Double-charge-prevention test passes (recon sees charge → SETTLED, one place-order)
- [x] `T_approve` timeout → ABANDONED (+ orphan cleanup) passes
- [x] Orphan cleanup: `closeCard` always called on ABANDONED-after-charge; P3 account-claim enqueued
- [x] Approval gate documented as "ours-not-Agentcard's" (code + this report)
- [x] Approval mandate signed (Ed25519) and replay-resistant
- [x] Worker boots against a live Temporal dev server (smoke + e2e)
- [x] No changes outside `packages/orchestrator/` and `apps/worker/` (besides the shared lockfile + this report)
- [x] Report committed and used as the PR body
