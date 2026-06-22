# @tomo/funding

The card funding rail. Implements `FundingRail` (from `@tomo/core`) over the **documented**
Agentcard Organizations REST API (`plans/technical/03-agentcard-client.md`).

## What's here

- **`AgentcardRail`** (`src/agentcard/agentcard-rail.ts`) — `FundingRail` over the documented
  endpoints. M0 lifecycle: hold → capture → release. **Cents-only**; rejects `amountCents > 5000`
  (org default $50/card ceiling) and `< 100` at the boundary, before any network call.
- **`AgentcardClient`** (`src/agentcard/client.ts`) — thin HTTP client. Maps every non-2xx to a
  typed `AgentcardError extends FundingError` (carries HTTP status; `setupUrl` on 422). Injectable
  `fetch` for testing.
- **`WebhookEventStore`** (`src/agentcard/event-store.ts`) — append-only, keyed by card id. The
  reconciliation source of truth; `listTransactions` projects it into `Txn[]` (Agentcard has no
  documented list-transactions endpoint).
- **`verifyAndIngest` / `verifySignature`** (`src/agentcard/webhooks.ts`) — HMAC-SHA256 signature
  verification (`whsec_` secret, constant-time compare) + schema-validated ingestion.
- **`BuyToolRail`** (`src/buy-tool/buy-tool-rail-stub.ts`) — Lane A `/buy` stub. Fails closed with
  `EXPLAIN_CANT(lane_a_unavailable)` until phase-06 (the `/buy` MCP tool is not in the public docs).

## SECRET-FLOW (prime directive)

`AgentcardRail.getCardSecret` returns `{ pan, cvv, expiry }`. That value flows **only** into the
Executor's page-fill path — never to the LLM, never logged, never persisted. A unit test asserts the
PAN/CVV never reach any `console` channel.

## Test + coverage

```bash
pnpm --filter @tomo/funding test
pnpm --filter @tomo/funding exec vitest run --coverage   # ≥80% lines enforced
```

## Sandbox verification (M0 acceptance gate — manual only)

`scripts/verify-sandbox.ts` proves **hold → capture → release** against the Agentcard sandbox. It
needs a real `sk_test_*` key and a human to complete the Stripe checkout step, so it is **never run
in CI**. It logs every step to stdout with **no secrets** (last4 only).

```bash
AGENTCARD_API_KEY=sk_test_... npx tsx packages/funding/scripts/verify-sandbox.ts
```

Steps: create cardholder → attach payment method (open the printed `checkoutUrl`, complete it) →
poll `/status` → `issueCard` (hold) → fetch `/details` + place a sandbox charge → observe
`transaction.authorized` → `transaction.cleared` → `closeCard` (release).
