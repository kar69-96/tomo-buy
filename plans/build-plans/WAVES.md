# Wave Schedule & Gating

Phases are grouped into ordered **waves**. Phases **within a wave run in parallel** (they own
disjoint package directories, so worktrees never collide at merge). Each phase **auto-merges its own
PR** into `main` once its Definition of Done is green (see `00-CONVENTIONS.md` §4) — no manual
hand-merge. A wave is a **hard gate**: the next wave does not begin until **every** phase PR in the
current wave has auto-merged to `main`.

```
WAVE 1   phase-00  scaffold + ALL contracts + stubs           ── merge ──►  GATE
WAVE 2   phase-01  funding (AgentcardRail)        ┐
         phase-02  intent + router + profiles     │  PARALLEL — branch off Wave-1 main
         phase-03  vaults + executor              │
         phase-04  orchestrator (Temporal)        ┘  ── all four merge ──►  GATE
WAVE 3   phase-05  api + ui + live P2 integration            ── merge ──►  LIVE P2 SLICE
WAVE 4+  deferred/* scheduled here as prioritized (Lane A, P3, email, SSO, P0, drift)
```

## Why Wave 1 is solo

`phase-00` freezes every shared interface and type (`FundingRail`, `MerchantProfile`, `TaskIntent`,
`RoutingDecision`, vault interfaces, error hierarchy, Zod schemas) and stubs every package. Wave-2
phases compile against those frozen contracts and never redefine them — that is what lets four
sessions build in parallel without stepping on each other.

## Wave 2 disjoint ownership (no two phases touch the same dir)

| Phase | Owns |
|---|---|
| phase-01 | `packages/funding/`, `packages/rails-x402/` (port only, P0 wired later) |
| phase-02 | `packages/intent/`, `packages/router/`, `packages/profiles/` |
| phase-03 | `packages/vaults/`, `packages/executor/` |
| phase-04 | `packages/orchestrator/`, `apps/worker/` |

Shared edits (e.g. adding a package to the workspace) are pre-declared in `phase-00` so Wave-2
phases only fill in their own package; they do not edit root workspace config.

## Wave 3

`phase-05` owns `packages/api/` and `apps/ui/` and wires the merged Wave-2 packages into the live
Lane B P2 path. It is solo because it integrates everything.

## Gate checklist (run before opening the next wave)

- [ ] Every phase PR in the current wave has **auto-merged** to `main` (not just opened); any phase
      that stayed an open PR was red — fix and re-run it before opening the next wave.
- [ ] `main` is green: `pnpm build && pnpm test` pass on a fresh clone.
- [ ] Each merged phase committed its `reports/phase-<id>-report.md`.
- [ ] Any follow-ups flagged in those reports are triaged (fix now vs. defer).

## Deferred phases (Wave 4+)

These are scheduled into later waves when prioritized. Each is self-contained with the same
template + report rule. Likely ordering once the slice is live:

1. `phase-06-lane-a-buy` — when Agentcard `/buy` access + schema are confirmed.
2. `phase-10-p0-machine-rail` — x402/MPP + vendor catalog + settlement wallet.
3. `phase-07-lane-b-p3-signup` + `phase-08-agent-email` (P3 needs the inbox).
4. `phase-09-p1-sso`.
5. `phase-11-profile-drift-health`.
