# Phase 07 — Lane B P3 (new-account provisioning) + three-way oracle

> **⛔ PREREQUISITE.** P3 needs the agent inbox: **phase-08 (agent email) must be merged first**.
> Also requires Wave-2 `packages/vaults` + `packages/executor` merged. P3 also brushes
> `plans/spec/02-open-decisions.md` #2 (automated account creation in user's real name → ToS + consent).

- **Phase:** 07 — Wave 4+ (deferred; schedule after phase-08)
- **Goal:** Implement the P3 path — the agent creates an account for the user (real identity, agent-
  minted credentials), with the §7 three-way existence oracle, `P3_ASSISTED` OTP/CAPTCHA relay,
  `EXPLAIN_CANT` terminals, and the account-claim handoff.
- **Owned packages:** `packages/executor/` (P3 path + signup state machine)
- **Depends on (merged):** phase-00, phase-03 (vaults+executor base), phase-08 (agent email), phase-05
- **Complexity:** High

---

## 1. Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-07 -b feat/phase-07-lane-b-p3-signup
cd ../tomo-phase-07 && pnpm install
```

**Owned dirs:** `packages/executor/` (P3 additions only).
**Do NOT touch:** `packages/email/` internals (consume its interface), vaults internals, router core
(routing to P3/P3_ASSISTED was defined in phase-02; this phase implements the path body).

## 2. Scope

- P3 signup flow: provision account with Vault B PII (field-by-field) + Vault A generated
  high-entropy password scoped per `(user, merchant)`.
- §7 **three-way existence oracle**: `PROCEEDED` / `DEFINITIVELY_EXISTS` / `INDETERMINATE`.
- `P3_ASSISTED`: human-relayed OTP/CAPTCHA when `automation_hostility == high`.
- `EXPLAIN_CANT` terminals (definitive-exists w/o SSO, couldn't-determine).
- Account-claim handoff entry point (set email-of-record → password reset; implemented in `packages/email`).

## 3. Contracts consumed (frozen in phase-00)

`MerchantProfile`, `TaskIntent`, Vault A/B interfaces, `EmailInbox` interface (phase-08), `EXPLAIN_CANT`
reasons, the Executor guardrail contract (§12), the §8 orphan-cleanup hooks.

## 4. Implementation steps (TDD-first)

1. Spec the oracle state machine; implement with hard rules:
   - **One attempt per identifier, only on a DEFINITIVE result.** INDETERMINATE must **not** burn it.
   - Probe only the **consented user's own identity, at the moment of acting** (no pre-scan/sweep).
   - **Lazy, not eager:** the existence probe is the **first side effect of the P3 signup attempt**,
     and only runs when `guest_checkout` is unavailable. If guest works, never probe.
2. Async reclassification: INDETERMINATE → wait for the inbox signal (email arrives → reclassify),
   else `EXPLAIN_CANT(reason="couldnt_determine")`.
3. Vault A password generation + write-once; Vault B field-level release at signup/checkout.
4. `P3_ASSISTED` OTP/CAPTCHA relay via the existing `/otp/relay` surface.
5. Orphan path: account-created-but-no-order → enqueue teardown / mark for account-claim (§8).

## 5. Reuse pointers

- Executor + placeholder injection already ported in phase-03 from
  `AgentPay useagentpay-x402/packages/sdk/src/executor/{executor,placeholder}.ts`.
- Browserbase driver from `AgentPay useagentpay/packages/mcp-server/src/browser/browserbase-proxy.ts`.

## 6. Definition of Done

- [ ] Oracle handles all three outcomes; identifier-burn rule unit-tested (INDETERMINATE never consumes).
- [ ] P3 signup → checkout succeeds on a sandbox/account-required test merchant.
- [ ] `P3_ASSISTED` relay works; `EXPLAIN_CANT` terminals fire correctly.
- [ ] No secret in LLM context/logs; guardrails enforced. ≥80% coverage.

## 7. Build & verify

```bash
pnpm build && pnpm test --filter @tomo/executor && pnpm test
```

## 8. PR creation + report

```bash
git push -u origin feat/phase-07-lane-b-p3-signup
gh pr create --base main --title "phase-07: Lane B P3 signup + three-way oracle" \
  --label "wave-TBD" --body-file plans/build-plans/reports/phase-07-report.md
```

Write + commit `reports/phase-07-report.md`. In the report, note ToS/consent (§15 #2) handling and any
merchant where the oracle was ambiguous.
