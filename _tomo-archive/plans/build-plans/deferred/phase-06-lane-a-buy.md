# Phase 06 — Lane A via Agentcard `/buy` MCP tool

> **⛔ BLOCKER (read first).** Agentcard's `/buy` MCP tool is **not in the public integration docs**
> (see `plans/spec/01-reality-reconciliation.md`). This phase **cannot start** until we have
> **confirmed Agentcard partner access + the `/buy` tool schema** (params, `account_bound`/connect
> support, user-notification routing). Tracked in `plans/spec/02-open-decisions.md` items #1 and #5.
> Until then, `BuyToolRail` stays the stub created in phase-00/phase-01 that returns
> `EXPLAIN_CANT(reason="lane_a_unavailable")`.

- **Phase:** 06 — Wave 4+ (deferred; schedule once blocker clears)
- **Goal:** Replace the Lane A stub with a real `/buy` integration so partner merchants (DoorDash,
  Good Eggs, …) route `TaskIntent → /buy`, with approval surfacing + OTP relay.
- **Owned packages:** `packages/funding/` (`BuyToolRail` real impl), `packages/router/` (Step 0 wiring only)
- **Depends on (merged):** Wave 1 (phase-00), Wave 3 (phase-05 live slice + approval/OTP UI surfaces)
- **External prerequisite:** Agentcard `/buy` access + schema confirmed
- **Complexity:** Medium (mostly integration), High risk (undocumented dependency)

---

## 1. Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-06 -b feat/phase-06-lane-a-buy
cd ../tomo-phase-06 && pnpm install
```

**Owned dirs:** `packages/funding/`, the Step-0 block in `packages/router/`.
**Do NOT touch:** vaults, executor, orchestrator, api, ui internals (consume their contracts only).

## 2. Scope

- Real `BuyToolRail` implementing the MCP `/buy` client (connect to Agentcard's MCP server).
- Map `TaskIntent` → `/buy` parameters (merchant, cart/item spec, `price_ceiling_cents`, address ref).
- Surface Agentcard's approval/OTP prompts into our existing approval + `/otp/relay` UI.
- Router Step 0: `profile.lane == "A"` → `AGENTCARD_BUY` (un-stub).

## 3. Contracts consumed (frozen in phase-00)

`FundingRail` / lane switch, `TaskIntent`, `RoutingDecision`, `EXPLAIN_CANT` reasons, the approval +
OTP relay service contracts from `packages/api`.

## 4. Implementation steps (TDD-first)

1. **Confirm schema** from the integration guide; write it into `packages/funding/buy-tool.types.ts`.
2. Spec the `TaskIntent → /buy` param mapping (incl. `account_bound`/connect path) → implement.
3. Spec approval-surfacing + OTP-relay bridging → implement against the §8 state machine.
4. Spec the §9 inbox-redirect caveat: confirm whether `/buy` notifies the user's real email and
   whether org config can redirect to our channel; encode the decision + a guard.
5. Un-stub router Step 0; assert Lane A merchants no longer return `lane_a_unavailable`.

## 5. Reuse pointers

- MCP client scaffold: `AgentPay useagentpay/packages/mcp-server/src/server.ts` + `tools/` patterns.
- Approval/OTP surfaces already built in Wave 3 (`packages/api`, `apps/ui`).

## 6. Definition of Done

- [ ] `/buy` schema documented in code; mapping unit-tested.
- [ ] Lane A merchant routes to a successful sandbox `/buy` purchase E2E (or partner sandbox).
- [ ] Approval + OTP relay surface correctly; inbox-redirect decision encoded.
- [ ] `pnpm build && pnpm test` green; ≥80% coverage on `packages/funding`.

## 7. Build & verify

```bash
pnpm build && pnpm test --filter @tomo/funding && pnpm test
```

## 8. PR creation + report

```bash
git push -u origin feat/phase-06-lane-a-buy
gh pr create --base main --title "phase-06: Lane A via Agentcard /buy" \
  --label "wave-TBD" --body-file plans/build-plans/reports/phase-06-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

Write + commit `plans/build-plans/reports/phase-06-report.md` (template in `reports/README.md`).
Call out in the report whether the `/buy` dependency behaved as documented, and any inbox-redirect risk.
