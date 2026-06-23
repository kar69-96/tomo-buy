# Phase 02 — Intent Parser + Deterministic Router

> **Self-contained runbook.** Read `../../../CLAUDE.md`. If anything conflicts with
> `../00-CONVENTIONS.md`, that file wins.

## Header

| | |
|---|---|
| **Phase id** | `phase-02` |
| **Wave** | 2 (parallel) |
| **Goal** | LLM intent parser (**intent-only**) + the deterministic §6 router cascade + seed merchant/P0 profiles. |
| **Owns** | `packages/intent/`, `packages/router/`, `packages/profiles/` |
| **Depends on** | Wave 1 merged (`packages/core` contracts) |
| **Parallel-safe-with** | phase-01, phase-03, phase-04 (disjoint dirs) |
| **Complexity** | Medium (router is pure logic; parser is one bounded LLM call) |

## Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-02 -b feat/phase-02
cd ../tomo-phase-02
pnpm install
```

**May touch:** `packages/intent/`, `packages/router/`, `packages/profiles/` only.
**Do NOT touch:** other packages, root config, `plans/`.

## Scope (files to create)

`packages/intent/`:
- `src/parse.ts` — `parseIntent(userId, text): Promise<TaskIntent>` via Vercel AI Gateway
  (`"anthropic/claude-..."` model string). **Output validated by `TaskIntentSchema` before return;
  untrusted until then.** Sets `account_bound`, extracts `price_ceiling_cents` (conservative default
  if absent, flagged for the approval gate). Emits **intent only** — never a path/lane.
- `src/index.ts`; `src/**/*.test.ts` (mock the model; assert account_bound triggers + ceiling defaults).

`packages/router/`:
- `src/cascade.ts` — `route(profile, intent): RoutingDecision`. Pure, deterministic, no LLM, no IO.
- `src/index.ts`; `src/cascade.test.ts` (exhaustive branch coverage).

`packages/profiles/`:
- `src/seed/*.ts` — 2–3 `MerchantProfile`s (one `guest_checkout:true` test merchant for P2; one
  `lane:"A"` to exercise the stub; one `account_required` no-SSO to exercise EXPLAIN_CANT) + 1
  `P0VendorCatalogEntry`.
- `src/repository.ts` — `getProfile(merchantId)` lookup (static for now).
- `src/index.ts`; `src/**/*.test.ts`.

## Contracts consumed (from `packages/core`)

`TaskIntent` + `TaskIntentSchema`, `MerchantProfile`, `RoutingDecision`, `Path`, `ExplainReason`,
`P0VendorCatalogEntry`, `RoutingError`.

## Router cascade (implement §6 EXACTLY, including the ordering fix)

```
STEP 0  if profile.lane == "A":            → AGENTCARD_BUY  (but current build: stub → EXPLAIN_CANT(lane_a_unavailable))
STEP 1  if intent.account_bound:           ← ORDERING FIX: checked BEFORE terminal rail
            if profile.sso_grant:          → P1
            else:                          → EXPLAIN_CANT(cant_reach_existing_account)
STEP 2  if profile.terminal_rail:          → P0
STEP 3  if profile.guest_checkout:         → P2                          (skip probe)
        elif profile.account_required:
              if profile.forces_3ds:       → EXPLAIN_CANT(3ds_wall)
              elif automation_hostility=="high":
                    if sso_grant:           → P1
                    else:                   → P3_ASSISTED
              else:                         → P3
        else:                              → EXPLAIN_CANT(no_viable_path)  (dead-corner guard)
```

Why the ordering fix matters: a terminal rail transacts **fresh** and cannot reach the user's
existing consumer account, so `account_bound` ("my usual", "my credit") must win first — otherwise
`terminal_rail` silently fails the user's intent. Each branch records human-readable `reasons[]`.

## Implementation steps (TDD-first)

1. **RED:** `cascade.test.ts` — a table of `(profile, intent) → expected Path/ExplainReason`,
   covering every branch incl. ordering fix, dead-corner, forces_3ds, hostility gating, Lane A stub.
2. Implement `cascade.ts` to green. Pure function; no side effects.
3. **RED:** `parse.test.ts` mocking the gateway; assert account_bound phrases set the flag, missing
   ceiling yields the conservative default + a `ceilingDefaulted` marker, output rejected if it fails
   `TaskIntentSchema`.
4. Implement `parse.ts`. Keep the system prompt strict: describe intent only, never choose a path.
5. Seed profiles + repository; tests that `getProfile` returns frozen copies (immutability).

## Reuse pointers (from AgentPay)

- LLM call shape / prompt-as-instruction discipline: `useagentpay/packages/mcp-server/src/prompts/buy.ts`.
- Zod-validated tool inputs pattern: `useagentpay/packages/mcp-server/src/tools/*.ts`.

## Definition of Done

- [ ] `pnpm build && pnpm test --filter intent --filter router --filter profiles` green; ≥80% coverage.
- [ ] Router covers every §6 branch (ordering fix + dead-corner verified by tests).
- [ ] Parser returns only a schema-valid `TaskIntent`; never a path/lane; ceiling default flagged.
- [ ] Lane A profile routes to `EXPLAIN_CANT(lane_a_unavailable)` (stub era).

## Build & verify

```bash
pnpm build && pnpm test --filter intent --filter router --filter profiles
```

## PR creation

```bash
git push -u origin feat/phase-02
gh pr create --base main --title "phase-02: intent parser + deterministic router" \
  --label "wave-2" --body-file plans/build-plans/reports/phase-02-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

## PR report (required)

Write + commit `plans/build-plans/reports/phase-02-report.md` and use it as the PR body.
