# Phase 04 — Temporal Approval / Recon / Orphan State Machine

> **Self-contained runbook.** Read `../../../CLAUDE.md`. If anything conflicts with
> `../00-CONVENTIONS.md`, that file wins.

## Header

| | |
|---|---|
| **Phase id** | `phase-04` |
| **Wave** | 2 (parallel) |
| **Goal** | The §8 approval + reconciliation + orphan-cleanup state machine on **Temporal** (free local dev server). |
| **Owns** | `packages/orchestrator/`, `apps/worker/` |
| **Depends on** | Wave 1 merged (`packages/core` contracts) |
| **Parallel-safe-with** | phase-01, phase-02, phase-03 (disjoint dirs) |
| **Complexity** | High (durable workflow; idempotency is the whole point) |

## Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-04 -b feat/phase-04
cd ../tomo-phase-04
pnpm install
# free local Temporal dev server (no cloud cost):
#   temporal server start-dev   (install the Temporal CLI if absent)
```

**May touch:** `packages/orchestrator/`, `apps/worker/` only.
**Do NOT touch:** other packages, root config, `plans/`.

## Scope (files to create)

`packages/orchestrator/`:
- `src/workflow/checkout.ts` — the durable workflow (states below).
- `src/activities/*.ts` — activity stubs typed against core interfaces: `issueCard`, `getCardSecret`,
  `placeOrder`, `reconcile`, `closeCard`, `surfaceApproval`, `relayOtp` (real impls injected in Wave 3).
- `src/recon.ts` — reconciliation-before-retry logic over the webhook event store + merchant order state.
- `src/mandate.ts` — ported Ed25519 approval-mandate signing.
- `src/index.ts`; `src/**/*.test.ts`.

`apps/worker/`:
- `src/worker.ts` — Temporal worker registering workflow + activities.
- `package.json`; a smoke test that the worker boots against the local dev server.

## Contracts consumed (from `packages/core`)

`FundingRail`, `CardRef`, `Txn`, `ChargeEvent`, `RoutingDecision`, `TaskIntent`, `ApprovalError`,
`ReconciliationError`. Activities are typed against these; Wave 3 injects concrete implementations.

## State machine (§8)

```
CART_BUILT → AWAITING_APPROVAL → CARD_ISSUED → CHARGE_PENDING
           → SETTLED | DECLINED | ABANDONED | NEEDS_RECON
```

- **AWAITING_APPROVAL** — surface merchant / final cart / total / card last4 (after issue) / ETA;
  **re-validate price & inventory** at approval time (carts go stale); `T_approve` timeout (e.g. 15m)
  → `ABANDONED`. **This human approval gate is OURS** (Temporal + UI) — Agentcard exposes **no**
  `202/approval_id` to drive it (see `plans/spec/01-reality-reconciliation.md`).
- **CARD_ISSUED → CHARGE_PENDING** — issue the single-use card for the **APPROVED** total (not the
  pre-approval estimate); inject PAN trusted-side (the Executor, Wave 3).
- **Idempotency / reconciliation (critical):** before ANY retry, call `listTransactions` (event store)
  + check merchant order state. Charge present → treat as `SETTLED`, do **not** re-place. No charge +
  card unused → safe to retry once, else `ABANDONED`. The single-use card is a fail-closed backstop —
  a retry against a spent card fails closed; rely on it deliberately.
- **ABANDONED cleanup (orphan path):** `closeCard()` releases the hold; if a P3 account was created
  but no order placed, enqueue teardown / mark for account-claim. Never leave a dangling hold or an
  orphaned PII-bearing account.
- **NEEDS_RECON** — human-review queue; never auto-retry spend from here.

## Implementation steps (TDD-first)

1. **RED (the headline test):** simulate "place order click succeeded but confirmation read failed."
   Drive the workflow through a retry; assert reconciliation sees the charge in the event store and
   resolves to `SETTLED` with **no second charge** (mock `FundingRail`/order-state).
2. Implement the workflow + activity signatures; wire `T_approve` timer → `ABANDONED`.
3. Implement `recon.ts`; test all three retry outcomes (charge present / unused / ambiguous).
4. Implement orphan cleanup; test `closeCard` is always called on `ABANDONED`.
5. Port Ed25519 mandate signing; test the approval mandate is signed and replay-resistant.
6. `apps/worker`: boot against `temporal server start-dev`; smoke test.

## Reuse pointers (from AgentPay)

- Transaction state machine: `useagentpay-x402/packages/sdk/src/transactions/` (`manager.ts`, `types.ts`).
- Mandate signing (Ed25519): `useagentpay-x402/packages/sdk/src/auth/mandate.ts`.

## Definition of Done

- [ ] `pnpm build && pnpm test --filter orchestrator --filter worker` green; ≥80% coverage.
- [ ] Double-charge-prevention test passes (reconciliation before retry).
- [ ] `T_approve` timeout → `ABANDONED` → `closeCard` released hold (tested).
- [ ] Approval gate documented as ours-not-Agentcard's; mandate signed.
- [ ] Worker boots against the local Temporal dev server.

## Build & verify

```bash
temporal server start-dev &        # background, free
pnpm build && pnpm test --filter orchestrator --filter worker
```

## PR creation

```bash
git push -u origin feat/phase-04
gh pr create --base main --title "phase-04: Temporal approval/recon/orphan SM" \
  --label "wave-2" --body-file plans/build-plans/reports/phase-04-report.md
```

## PR report (required)

Write + commit `plans/build-plans/reports/phase-04-report.md` and use it as the PR body. Confirm the
no-double-charge test passed; flag any activity left stubbed for Wave 3 wiring.
