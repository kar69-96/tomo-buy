# Phase 10 — P0 machine rail (direct x402 / MPP + in-house catalog)

> **⛔ BLOCKER (read first).** Dropping a third-party issuer means **we self-hold the x402/MPP
> settlement wallet** (a stablecoin treasury). That custody + money-transmission/VASP surface is a
> **§15 legal sign-off item** (`plans/spec/02-open-decisions.md` #1) and must be blessed by counsel
> before this rail goes to production. Sandbox/testnet build can proceed earlier.

- **Phase:** 10 — Wave 4+ (deferred)
- **Goal:** The terminal/programmatic path — a pure backend call against a vendor's sanctioned
  machine rail, **zero custody of user data, no browser, no account, no card**.
- **Owned packages:** `packages/rails-x402/` (wire P0 routing — code ported but unwired in phase-01),
  `packages/profiles/` (P0 vendor catalog + onboarding/verification), `packages/router/` (Step 2 wiring)
- **Depends on (merged):** phase-00, phase-01 (rails-x402 port), phase-02 (profiles/router)
- **External prerequisite:** settlement-wallet custody decision (legal) for production
- **Complexity:** High

---

## 1. Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-10 -b feat/phase-10-p0-machine-rail
cd ../tomo-phase-10 && pnpm install
```

**Owned dirs:** `packages/rails-x402/`, the P0 catalog area of `packages/profiles/`, the Step-2 block
in `packages/router/`.
**Do NOT touch:** card-rail (`packages/funding`), executor, vaults — P0 never touches them.

## 2. Scope

- Direct **x402** client (Coinbase stablecoin-native HTTP 402) **and** **MPP** client — in-house, no
  third-party issuer/wallet provider.
- **Self-maintained P0 vendor catalog** (§3.5): `vendor_id`, `protocol` (x402|mpp), `endpoint`,
  `order_schema`, `pricing`, `settlement` (chain/asset), `last_verified_at`, `catalog_version`.
  Presence in the catalog with a live endpoint is what sets `terminal_rail == true`.
- **Self-held settlement wallet** (stablecoin treasury) with **spending controls**
  (`dailyCents` / `perTxCents` / `allowedVendors`) mirroring the §12 executor guardrails. **Model sees
  no wallet key** — it emits a pay-intent only; the trusted side settles.
- Catalog onboarding (one vendor at a time, or auto-discover from x402-advertising 402 responses) +
  scheduled verification (stale entries fall back out of P0).
- Router Step 2: `terminal_rail == true` → `MachineRail.pay(vendor_id, …)`.

## 3. Contracts consumed (frozen in phase-00)

`MachineRail` interface, `MerchantProfile.terminal_rail`, P0 catalog schema, `OrderSpec`, the §12
guardrail constants.

## 4. Implementation steps (TDD-first)

1. Wire the ported x402 client (EIP-3009/USDC/Base) behind `X402Rail`; add `MPPRail` skeleton.
2. Spec the catalog schema + onboarding/verification job → implement; assert stale entries drop out.
3. Spec spending controls on the wallet → implement; assert per-tx/daily/allowlist enforcement.
4. Spec **no-wallet-key-in-model** boundary; assert pay-intent handle only.
5. Wire router Step 2; assert a catalog vendor routes to P0 with no browser/account/card.

## 5. Reuse pointers

- `AgentPay useagentpay-x402/packages/x402/src/client/payment-handler.ts` (EIP-3009/USDC/Base, balance
  checks), `client/wallet.ts` (EVM wallet gen), `router/payment-router.ts` (rail selection) — these
  were ported into `packages/rails-x402` in phase-01; this phase activates + wires them.

## 6. Definition of Done

- [ ] x402 testnet payment settles E2E against a catalog vendor; MPP path stubbed or implemented.
- [ ] Catalog onboarding + verification works; spending controls enforced + tested.
- [ ] Router Step 2 routes correctly; no user-data custody on the path. ≥80% coverage.
- [ ] Wallet keys never enter model context/logs (verified).

## 7. Build & verify

```bash
pnpm build && pnpm test --filter @tomo/rails-x402 && pnpm test
```

## 8. PR creation + report

```bash
git push -u origin feat/phase-10-p0-machine-rail
gh pr create --base main --title "phase-10: P0 machine rail (x402/MPP + catalog)" \
  --label "wave-TBD" --body-file plans/build-plans/reports/phase-10-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

Write + commit `reports/phase-10-report.md`. **Explicitly record** the settlement-wallet custody status
(§15 #1) and confirm production is gated on legal sign-off.
