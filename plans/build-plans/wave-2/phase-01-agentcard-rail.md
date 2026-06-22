# Phase 01 — Agentcard Rail (M0) + x402 Port

> **Self-contained runbook.** Read `../../../CLAUDE.md` for goals + rules. If anything conflicts
> with `../00-CONVENTIONS.md`, that file wins.

## Header

| | |
|---|---|
| **Phase id** | `phase-01` |
| **Wave** | 2 (parallel) |
| **Goal** | Implement `AgentcardRail` (M0) against the **documented** REST API + port the x402 client (not yet wired into routing). |
| **Owns** | `packages/funding/`, `packages/rails-x402/` |
| **Depends on** | Wave 1 merged (`packages/core` contracts) |
| **Parallel-safe-with** | phase-02, phase-03, phase-04 (disjoint dirs) |
| **Complexity** | High (live API + webhooks + reconciliation source of truth) |

## Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-01 -b feat/phase-01
cd ../tomo-phase-01
pnpm install
```

**May touch:** `packages/funding/`, `packages/rails-x402/`, and that package's own entries only.
**Do NOT touch:** any other package, root workspace config, `plans/`.

## Scope (files to create)

`packages/funding/`:
- `src/agentcard/client.ts` — thin HTTP client (base `https://api.agentcard.sh`, `Authorization: Bearer`).
- `src/agentcard/agentcard-rail.ts` — `AgentcardRail implements FundingRail`.
- `src/agentcard/webhooks.ts` — signature verify (`whsec_`) + event-store ingestion.
- `src/agentcard/event-store.ts` — persisted webhook events; backs `listTransactions`.
- `src/buy-tool/buy-tool-rail-stub.ts` — Lane A stub returning `EXPLAIN_CANT(lane_a_unavailable)`.
- `src/index.ts`; `src/**/*.test.ts`.

`packages/rails-x402/` (PORT, compile + test, but **P0 routing is wired in deferred phase-10**):
- `src/client/payment-handler.ts`, `src/client/wallet.ts`, `src/router/payment-router.ts` (ported).
- `src/index.ts` exposing `X402Rail implements MachineRail` (contract from core); `src/**/*.test.ts`.

## Contracts consumed (from `packages/core`)

`FundingRail`, `MachineRail`, `CardholderRef`, `CardRef`, `PAN_CVV_EXP`, `Txn`, `ChargeEvent`,
`Settlement`, `OrderSpec`, `FundingError`. **Do not redefine these.**

## Documented Agentcard endpoints (code to these — NOT the spec's §1 guesses)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/v1/cardholders` | `{firstName,lastName,dateOfBirth,phoneNumber,email}` | `{id:"ch_…"}` (409 on dup email) |
| POST | `/api/v1/cardholders/{id}/payment-method/setup` | — | `{checkoutUrl,stripeSessionId}` |
| GET | `/api/v1/cardholders/{id}/payment-method/status` | — | `{hasPaymentMethod,paymentMethodId}` |
| POST | `/api/v1/cards` | `{amountCents,cardholderId}` | `{id,last4,expiry,spendLimitCents,balanceCents,status:"OPEN"}` (422 → `setupUrl`) |
| GET | `/api/v1/cards/{id}/details` | — | `{pan,cvv,expiry,last4}` (audit-logged) |
| DELETE | `/api/v1/cards/{id}` | — | `{status:"CLOSED"}` (idempotent, releases hold) |
| GET | `/api/v1/cards?status=&cardholderId=&limit=&offset=` | — | `{cards,total,limit,offset}` |
| POST | `/api/v1/webhook_endpoints` | `{url,enabled_events}` | `{whsec_…}` |

Webhook events: `transaction.authorized|declined|cleared|voided`, `card.created|updated|closed`,
`cardholder.created|updated`, `balance.low`. **There is no documented `202/approval_id` mechanism**
and no documented list-transactions endpoint — `listTransactions` reads the webhook event store.

## Implementation steps (TDD-first)

1. **RED:** write `agentcard-rail.test.ts` mocking the HTTP client; assert `issueCard` rejects
   `amountCents > 5000`, sends cents, maps responses to `CardRef`; `getCardSecret` returns
   `PAN_CVV_EXP` and is never logged; `closeCard` is idempotent.
2. Implement `client.ts` + `agentcard-rail.ts` to green. Cents-only; surface 400/402/404/409/422 as
   typed `FundingError`s (include `setupUrl` on 422).
3. `webhooks.ts`: verify `AgentCard-Signature` against `whsec_`; reject bad signatures; write events
   to `event-store.ts`. `listTransactions(cardRef)` projects the event store into `Txn[]`.
4. `buy-tool-rail-stub.ts`: returns `EXPLAIN_CANT(lane_a_unavailable)` (real `/buy` is phase-06).
5. Port x402 files into `rails-x402` unchanged where possible; adapt imports to `core`'s `MachineRail`.
   Keep its existing unit tests; do not wire it into the router (that's phase-10).
6. Write the **sandbox verification script** `packages/funding/scripts/verify-sandbox.ts` (documented
   below) and a README note on running it.

## Sandbox verification script (proves hold → capture → release)

`scripts/verify-sandbox.ts` (run manually with `sk_test_*`, never in CI):
1. create cardholder → attach payment method (open `checkoutUrl` once, manually) → poll `/status`.
2. `issueCard($amount)` → assert `status:OPEN`, hold placed.
3. fetch `/details` → place a sandbox charge → observe `transaction.authorized` then `transaction.cleared` webhooks.
4. `closeCard` → assert hold released.
Log every step to stdout (no secrets). This is the M0 acceptance gate.

## Reuse pointers (from AgentPay)

- x402: `useagentpay-x402/packages/x402/src/client/payment-handler.ts` (EIP-3009/USDC/Base),
  `client/wallet.ts`, `router/payment-router.ts`.
- HTTP error + retry patterns, error hierarchy: `useagentpay-x402/packages/sdk/src/errors.ts`.

## Definition of Done

- [ ] `pnpm build && pnpm test --filter funding --filter rails-x402` green; ≥80% coverage.
- [ ] `AgentcardRail` implements the full `FundingRail` contract; cents enforced; `>5000` rejected.
- [ ] Webhook signature verification + event store backing `listTransactions`.
- [ ] No PAN/CVV in logs (assert in a test).
- [ ] Sandbox script documented; (if a sandbox key is available) hold→capture→release run captured in the report.
- [ ] Lane A `BuyToolRail` stub returns `EXPLAIN_CANT(lane_a_unavailable)`.

## Build & verify

```bash
pnpm build && pnpm test --filter funding --filter rails-x402
# optional, needs sk_test_ in .env (never committed):
AGENTCARD_API_KEY=sk_test_... npx tsx packages/funding/scripts/verify-sandbox.ts
```

## PR creation

```bash
git push -u origin feat/phase-01
gh pr create --base main --title "phase-01: Agentcard rail (M0) + x402 port" \
  --label "wave-2" --body-file plans/build-plans/reports/phase-01-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

## PR report (required)

Write + commit `plans/build-plans/reports/phase-01-report.md` (template in `../reports/README.md`)
and use it as the PR body. If no sandbox key was available, say so and mark the hold→capture check
as **not yet verified** under failures/known-gaps. Reference §15 money-transmitter item.
