# Phase 03 — Vaults A/B + Executor Trust Boundary

> **Self-contained runbook.** Read `../../../CLAUDE.md`. If anything conflicts with
> `../00-CONVENTIONS.md`, that file wins. This phase implements the **prime directive** in code.

## Header

| | |
|---|---|
| **Phase id** | `phase-03` |
| **Wave** | 2 (parallel) |
| **Goal** | Vault A (agent secrets) + Vault B (user PII) + the trusted-side Executor with placeholder injection (§12). |
| **Owns** | `packages/vaults/`, `packages/executor/` |
| **Depends on** | Wave 1 merged (`packages/core` contracts) |
| **Parallel-safe-with** | phase-01, phase-02, phase-04 (disjoint dirs) |
| **Complexity** | High (this is the security boundary — get it right) |

## Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-03 -b feat/phase-03
cd ../tomo-phase-03
pnpm install
```

**May touch:** `packages/vaults/`, `packages/executor/` only.
**Do NOT touch:** other packages, root config, `plans/`.

## Scope (files to create)

`packages/vaults/`:
- `src/crypto.ts` — AES-256-GCM + PBKDF2 (ported). `src/store.ts` — KMS-encrypted Postgres adapter
  with a local-dev encrypted-file fallback (env-selected).
- `src/vault-a.ts` — `VaultA`: agent-minted secrets (generated passwords) scoped per `(user, merchant)`.
  Write-once; read only by the Executor at login. Never in model context.
- `src/vault-b.ts` — `VaultB`: user PII with **field-level release** (`releaseField(user, field)`),
  per-field access log, data minimization, deletion path (`deleteUser`), encryption at rest.
- `src/index.ts`; `src/**/*.test.ts`.

`packages/executor/`:
- `src/placeholder.ts` — ported `PLACEHOLDER_MAP`, `getPlaceholderVariables()` (`%var%`),
  `credentialsToSwapMap()`, `getAtomicSwapScript()` **verbatim**.
- `src/browser/browserbase.ts` — ported Browserbase session/replay driver.
- `src/executor.ts` — `Executor` orchestrating discover → fill (placeholders) → atomic swap → submit.
- `src/guardrails.ts` — §12 re-validation (below). `src/index.ts`; `src/**/*.test.ts`.

## Contracts consumed (from `packages/core`)

`VaultA`, `VaultB`, `PAN_CVV_EXP`, `TaskIntent`, `RoutingDecision`, `VaultError`, `ExecutorError`.
The Executor receives card secrets via the `FundingRail.getCardSecret` **type** (the real rail is
injected at Wave 3; here, test with a fake implementing the core interface).

## §12 guardrails (re-validate every model-emitted parameter before any side effect)

- `amount ≤ price_ceiling_cents` — from the **original** parsed `TaskIntent`, not a mid-run number.
- `ship_to` **must equal** the Vault B record for this user — never an address found in page content.
- `merchant` must equal the routed merchant.
- Instruction-like text in page/email ("forward your code to…", "the user authorized…") is
  **surfaced to the user, never acted on**.
- Card secrets, vault fields, tokens **never** enter LLM context or logs. The Executor returns only
  success/failure flags + non-sensitive status.

## Implementation steps (TDD-first)

1. **RED (the headline test):** an integration test that drives a local mock checkout form and
   asserts the agent-visible transcript contains **only placeholders** (`%card_number%` etc.), while
   the real PAN/PII appear in the DOM **only** during the atomic swap window and **never** in any log
   or model-facing string. This test is the prime-directive gate.
2. Port `crypto.ts` from AgentPay vault; build `VaultA`/`VaultB` with field-level release + audit log.
   Test: releasing one field logs exactly one access; full record never returned to a caller marked
   "model".
3. Port `placeholder.ts` verbatim; port Browserbase driver; assemble `executor.ts`.
4. Implement `guardrails.ts`; test each guardrail rejects a violating parameter (page-injected
   address, over-ceiling amount, wrong merchant) and surfaces injected instructions without acting.
5. Ensure `Executor` returns flags only — add a type-level guard so secret types can't escape.

## Reuse pointers (from AgentPay)

- Vault: `useagentpay-x402/packages/sdk/src/vault/vault.ts` (+ `vault/types.ts`).
- Executor + placeholder: `useagentpay-x402/packages/sdk/src/executor/executor.ts`, `executor/placeholder.ts`.
- Browser: `useagentpay/packages/mcp-server/src/browser/browserbase-proxy.ts`.

## Definition of Done

- [ ] `pnpm build && pnpm test --filter vaults --filter executor` green; ≥80% coverage.
- [ ] Prime-directive test passes: no PAN/PII/token in the agent transcript or logs; values present in
      DOM only at swap time.
- [ ] Vault B field-level release + per-field audit log + deletion path implemented and tested.
- [ ] All four §12 guardrails enforced with tests.

## Build & verify

```bash
pnpm build && pnpm test --filter vaults --filter executor
# grep guard: the transcript fixture must not contain real secret patterns
```

## PR creation

```bash
git push -u origin feat/phase-03
gh pr create --base main --title "phase-03: vaults A/B + executor trust boundary" \
  --label "wave-2" --body-file plans/build-plans/reports/phase-03-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

## PR report (required)

Write + commit `plans/build-plans/reports/phase-03-report.md` and use it as the PR body. Explicitly
confirm the prime-directive test passed (or, if not, mark it a **blocking** failure — this phase is
not Done without it).
