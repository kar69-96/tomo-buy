# Approval + Reconciliation + Orphan-Cleanup State Machine (§8)

This is the **highest-risk subsystem**: money is spent over flaky browser automation, and we own
the human authorization gate (Agentcard exposes **no** documented `202/approval_id` — see
`../spec/01-reality-reconciliation.md`). It runs on **Temporal** (free local dev server) so
timeouts, retries-with-reconciliation, and orphan cleanup survive crashes. Lives in
`packages/orchestrator/` + `apps/worker/`.

## States

```
CART_BUILT ─► AWAITING_APPROVAL ─► CARD_ISSUED ─► CHARGE_PENDING
                                                  ├─► SETTLED
                                                  ├─► DECLINED
                                                  ├─► ABANDONED
                                                  └─► NEEDS_RECON
```

## AWAITING_APPROVAL

- Surface to the user UI: merchant, final cart, total, card last4 (after issue), ETA.
- **Re-validate price & inventory at approval time** — carts go stale between build and approve.
- Timeout `T_approve` (e.g. 15 min) → `ABANDONED`.
- We own this gate; it is **not** an Agentcard feature. It is a first-class state, not an error.

## CARD_ISSUED → CHARGE_PENDING

- Issue a single-use card for the **APPROVED** total (not the pre-approval estimate). Cents only;
  reject `amountCents > 5000` (the $50 default cap) — see funding rail.
- Inject PAN **trusted-side** (Lane B Executor) or hand off to `/buy` (Lane A, deferred).

## Idempotency / reconciliation (critical)

A "place order" click can succeed while the confirmation read fails. **Before ANY retry:**

1. Consult the **webhook event store** (our reconciliation source of truth — Agentcard sends
   `transaction.authorized/cleared/...`; there is no documented `listTransactions` poll) **and**
   the merchant order state.
2. If a charge is present → treat as `SETTLED`, **do not re-place**.
3. If no charge **and** the card is unused → safe to retry **once**, else `ABANDONED`.

The **single-use card is a deliberate backstop**: a retry against a spent card fails closed. Rely
on this on purpose; do not discover it by accident.

## ABANDONED cleanup (orphan path)

- `closeCard()` to release the Agentcard hold — **never leave a dangling hold**.
- If a P3 account was created but no order placed, we now hold a merchant account with the user's
  real PII for nothing → enqueue teardown / mark for **account-claim** (`07-email-architecture.md`).
- **Never** leave a dangling hold or an orphaned PII-bearing account.

## NEEDS_RECON

Human-review queue. **Never auto-retry spend from here.**

## Webhook event store

- `POST /api/v1/webhook_endpoints` registers our endpoint; verify the `whsec_` signature on every
  event. Persist every `transaction.*`, `card.*`, `balance.low` event.
- The store drives reconciliation and the SETTLED/DECLINED/REVERSED transitions; it is queried
  before any retry decision.

## Verification (phase-04 / phase-05)

- Simulate "order placed but confirmation read failed" → assert no double charge (the recon step
  sees the charge in the event store and transitions to `SETTLED`).
- Kill the Temporal worker mid-charge; on resume, reconciliation prevents a second charge against
  the spent single-use card.
