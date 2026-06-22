# Phase 05 — Live Lane B P2 Path (Integration)

> **Self-contained runbook.** Read `../../../CLAUDE.md`. If anything conflicts with
> `../00-CONVENTIONS.md`, that file wins. This is the slice's payoff: one real guest checkout end-to-end.

## Header

| | |
|---|---|
| **Phase id** | `phase-05` |
| **Wave** | 3 (SOLO — integrates all of Wave 2) |
| **Goal** | Wire the live Lane B **P2 guest-checkout** path end-to-end behind the approval gate. |
| **Owns** | `packages/api/`, `apps/ui/` |
| **Depends on** | **Wave 2 fully merged** (funding, intent+router, vaults+executor, orchestrator) |
| **Parallel-safe-with** | none (solo wave) |
| **Complexity** | High (integration + real sandbox run) |

## Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main   # MUST include all merged Wave-2 work
git worktree add ../tomo-phase-05 -b feat/phase-05
cd ../tomo-phase-05
pnpm install
temporal server start-dev &     # free local durable backend
```

**May touch:** `packages/api/`, `apps/ui/` only. Wire other packages by **importing** them — do not
edit their source. **Do NOT touch:** Wave-1/Wave-2 package internals, root config, `plans/`.

## Scope (files to create)

`packages/api/` (the §14 internal service contracts):
- `src/routes/intent.ts` — `POST /intent  {userId,text} → TaskIntent` (calls `intent.parseIntent`).
- `src/routes/route.ts` — `POST /route  TaskIntent → RoutingDecision` (calls `router.route` + `profiles`).
- `src/routes/execute.ts` — `POST /execute  RoutingDecision → starts the Temporal workflow`.
- `src/routes/approval.ts` — `POST /approval/resolve {workflowId,decision}` (signals the workflow).
- `src/routes/otp.ts` — `POST /otp/relay {workflowId,code}` (signals the workflow).
- `src/routes/webhook.ts` — `POST /webhook` (Agentcard events → event store → workflow signals).
- `src/routes/workflow.ts` — `GET /workflow/:id → state` (for the UI).
- `src/server.ts`; `src/**/*.test.ts`.

`apps/ui/`:
- A minimal text/portal surface: submit a prompt, see the routed plan + cart + total + last4,
  **approve / reject**, and **relay an OTP**. Server-rendered or tiny SPA — keep it small.

## Contracts consumed

Everything from Wave 2 via package imports: `funding` (`AgentcardRail`), `intent` (`parseIntent`),
`router` (`route`) + `profiles`, `vaults` + `executor`, `orchestrator` (start workflow, signal).
Concrete implementations are injected here — this phase is the composition root.

## End-to-end flow to wire (P2 guest checkout)

```
user text
  → POST /intent      → TaskIntent (intent-only)
  → POST /route       → RoutingDecision (P2 for the guest-checkout test merchant)
  → POST /execute     → Temporal workflow: CART_BUILT
       Executor (Browserbase) builds the guest cart, extracts price
  → AWAITING_APPROVAL → UI surfaces merchant/cart/total/ETA; user approves
  → CARD_ISSUED       → AgentcardRail.issueCard(approved total)  (≤ $50 cap)
  → CHARGE_PENDING    → Executor injects PAN trusted-side (atomic swap), places order
  → webhook           → transaction.authorized/cleared → reconciliation → SETTLED
  → receipt           → GET /workflow/:id shows final reconciled state
```

## Implementation steps (TDD-first)

1. **RED:** an integration test of the happy path with mocked externals (fake `FundingRail`, a local
   mock merchant page for the Executor, in-memory Temporal test env) asserting the workflow reaches
   `SETTLED` and the agent transcript never holds a secret.
2. Implement each `/route` handler thin; the composition root injects real package implementations.
3. Build the minimal UI for approve + OTP relay; signal the workflow on user action.
4. Wire the webhook route into the event store + workflow signals.
5. **Live sandbox run:** against a real guest-checkout test merchant with `sk_test_*`, drive the full
   flow once and capture the run (states, last4, reconciled receipt) for the report.

## Reuse pointers (from AgentPay)

- MCP/server scaffold + tool registration: `useagentpay/packages/mcp-server/src/server.ts`, `tools/`.
- Confirmation verification heuristics (page-text positive/negative signals):
  `useagentpay/packages/mcp-server/src/tools/checkout.ts`.

## Definition of Done

- [ ] `pnpm build && pnpm test` (full workspace) green; ≥80% coverage on `api`.
- [ ] Happy-path integration test reaches `SETTLED`; no secret in transcript/logs.
- [ ] All §14 endpoints implemented; UI can approve + relay OTP.
- [ ] **Live sandbox P2 run** completed end-to-end (or, if blocked, the blocker is documented as a
      failure with exactly what's missing — e.g. no sandbox merchant/key).
- [ ] Final workflow state is reconciled; hold released or captured correctly.

## Build & verify

```bash
temporal server start-dev &
pnpm build && pnpm test
# live slice (needs sk_test_ + a guest-checkout test merchant in .env, never committed):
pnpm --filter api dev   # then drive via apps/ui or curl the /intent→/route→/execute chain
```

## PR creation

```bash
git push -u origin feat/phase-05
gh pr create --base main --title "phase-05: live Lane B P2 guest-checkout slice" \
  --label "wave-3" --body-file plans/build-plans/reports/phase-05-report.md
```

## PR report (required)

Write + commit `plans/build-plans/reports/phase-05-report.md` and use it as the PR body. Include the
captured live-run trace (states + reconciled receipt) or, if the live run couldn't execute, a precise
account of what was missing. This phase closing green = the vertical slice is real.
