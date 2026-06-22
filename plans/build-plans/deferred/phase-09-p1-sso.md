# Phase 09 — P1 SSO / OAuth integration

> **PREREQUISITE.** Wave 1 (phase-00) + Wave 2 (router from phase-02) merged. No external blocker.
> Enables the **self-upgrading property**: a Lane-B P3 merchant becomes P1 the day it ships SSO.

- **Phase:** 09 — Wave 4+ (deferred)
- **Goal:** Let the user authorize access to their **own existing account** via the merchant's SSO/
  OAuth screen, returning a **scoped, revocable token — never a password, never a captured session**.
- **Owned packages:** `packages/sso/` (new), `packages/router/` (P1 wiring only)
- **Depends on (merged):** phase-00, phase-02
- **Complexity:** Medium-High

---

## 1. Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-09 -b feat/phase-09-p1-sso
cd ../tomo-phase-09 && pnpm install
```

**Owned dirs:** `packages/sso/`, the P1 branch wiring in `packages/router/`.
**Do NOT touch:** executor/vault internals, other rails.

## 2. Scope

- OAuth **authorization-code + PKCE** client for merchant consumer-grant flows.
- Encrypted **per-user / per-merchant scoped-token store** with refresh handling + revocation path.
- **Re-link flow** for expired tokens — a **first-class state, not an error** ("tap to reconnect").
- Human-approval surface: the connect/authorize tap + per-action confirmation for irreversible actions.
- Router: land on P1 when task is `account_bound` with `sso_grant == true`, or when P3 signup bounced
  `DEFINITIVELY_EXISTS` and `sso_grant == true`.

## 3. Contracts consumed (frozen in phase-00)

`MerchantProfile.sso_grant`, `TaskIntent.account_bound`, `RoutingDecision`, the token-store interface
(freeze in phase-00 `packages/core`), the approval UI surface from `packages/api`.

## 4. Implementation steps (TDD-first)

1. Spec PKCE flow (code challenge/verifier, state) → implement client.
2. Spec encrypted token store (per-user/per-merchant, refresh, revoke) → implement (KMS-Postgres,
   same discipline as vaults; **no decrypt in app/LLM tier**).
3. Spec re-link as a first-class state machine transition → implement.
4. Wire router P1 branch; assert execution uses **granted token scope only** — never a password login.

## 5. Reuse pointers

- Token-store encryption mirrors the vault pattern ported in phase-03 from
  `AgentPay useagentpay-x402/packages/sdk/src/vault/vault.ts`.

## 6. Definition of Done

- [ ] PKCE flow works against at least one real merchant OAuth (or a conformant mock).
- [ ] Token store encrypts, refreshes, revokes; re-link flow tested.
- [ ] Router routes account-bound + sso_grant cases to P1; never drives password login. ≥80% coverage.

## 7. Build & verify

```bash
pnpm build && pnpm test --filter @tomo/sso && pnpm test
```

## 8. PR creation + report

```bash
git push -u origin feat/phase-09-p1-sso
gh pr create --base main --title "phase-09: P1 SSO/OAuth" \
  --label "wave-TBD" --body-file plans/build-plans/reports/phase-09-report.md
```

Write + commit `reports/phase-09-report.md`.
