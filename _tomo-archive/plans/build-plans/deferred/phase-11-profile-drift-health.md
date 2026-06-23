# Phase 11 — Profile drift health checks

> **PREREQUISITE.** Wave 1 (phase-00) + Wave 2 (phase-02 profiles) merged. Best scheduled after the
> live slice is running so there is real routing to monitor. No external blocker.

- **Phase:** 11 — Wave 4+ (deferred; spec §16 M8)
- **Goal:** Keep merchant capability profiles honest over time — distinguish "**our selectors broke**"
  from "**the merchant changed capability**", version profiles, and fail gracefully mid-run.
- **Owned packages:** `packages/profiles/` (health-check additions), a monitoring job (in `apps/worker`
  as a scheduled Temporal workflow, or `packages/profiles/health/`)
- **Depends on (merged):** phase-00, phase-02, phase-04 (Temporal, if using scheduled workflow)
- **Complexity:** Medium

---

## 1. Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-11 -b feat/phase-11-profile-drift-health
cd ../tomo-phase-11 && pnpm install
```

**Owned dirs:** `packages/profiles/health/`, the scheduled job in `apps/worker/`.
**Do NOT touch:** router core logic, executor internals (read their signals only).

## 2. Scope

- **Drift classifier:** given a failed run, decide whether it's a selector/automation break (our bug)
  vs a capability change (merchant shipped SSO, removed guest checkout, added 3DS, etc.).
- **Profile versioning:** maintain `profile_version` + `last_verified_at`; bump on confirmed change.
- **Graceful mid-run failure:** on unrecoverable drift, terminate to `EXPLAIN_CANT` — **never hang**
  (ties into the Browserbase human-handoff fallback).
- **Scheduled re-verification:** periodically re-probe profiles; **stale P0 catalog entries fall back
  out of P0** (mirrors phase-10's verification cadence).

## 3. Contracts consumed (frozen in phase-00)

`MerchantProfile` (incl. `profile_version`, `last_verified_at`), `EXPLAIN_CANT` reasons, the run-
outcome/telemetry shape emitted by the executor + router.

## 4. Implementation steps (TDD-first)

1. Spec the drift classifier with labeled fixtures (selector-break vs capability-change) → implement.
2. Spec profile versioning bump rules → implement.
3. Spec graceful-failure path (drift → `EXPLAIN_CANT`, no hang) → implement + test against a timeout.
4. Spec scheduled re-verification job (Temporal cron-style) → implement; assert stale entries drop.

## 5. Reuse pointers

- Temporal worker scaffolding from phase-04 (`apps/worker`).
- Confirmation-signal scanning patterns from `AgentPay useagentpay/packages/mcp-server/src/tools/checkout.ts`
  (positive/negative page-text signals) inform drift detection.

## 6. Definition of Done

- [ ] Classifier separates selector-break from capability-change on fixtures (precision tested).
- [ ] Versioning bumps correctly; re-verification job runs + drops stale entries.
- [ ] Mid-run drift always terminates to `EXPLAIN_CANT`, never hangs (timeout-tested). ≥80% coverage.

## 7. Build & verify

```bash
pnpm build && pnpm test --filter @tomo/profiles && pnpm test
```

## 8. PR creation + report

```bash
git push -u origin feat/phase-11-profile-drift-health
gh pr create --base main --title "phase-11: profile drift health checks" \
  --label "wave-TBD" --body-file plans/build-plans/reports/phase-11-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

Write + commit `reports/phase-11-report.md`. Note any merchant profiles found stale/incorrect during
the build.
