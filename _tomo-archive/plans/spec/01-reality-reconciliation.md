# Reality Reconciliation — Agentcard docs vs spec §1

> Confirmed against `https://docs.agentcard.sh/integration-guide` this session. **The client must be
> coded to the docs, not the spec.** The spec's §1 explicitly marked these TO-CONFIRM; here is the
> confirmation.

## The contradictions

| Spec §1 claim | Documented reality | Consequence |
|---|---|---|
| `/buy` MCP tool drives Lane A | **Not in public docs at all** | **Lane A deferred**; `BuyToolRail` is a stub returning `EXPLAIN_CANT(lane_a_unavailable)` |
| Approval = `HTTP 202 + approval_id`, resolved via approval endpoint | **No such mechanism documented** | **We own the human approval gate** (Temporal + UI). It is not an Agentcard API feature. |
| `payment-methods` (plural) | `POST /api/v1/cardholders/{id}/payment-method/setup` (**singular**), returns a **Stripe** `checkoutUrl` | Use the singular path; attach is a Stripe-hosted one-time flow |
| Confirm org per-card limit | **$50/card default** for API orgs ("max 5000 by default — contact support to raise") | Enforce `amountCents ≤ 5000` at the rail; surface limit errors; raising it is an open decision |
| `listTransactions` endpoint | **Not documented**; transactions arrive via webhooks (`transaction.authorized/cleared/declined/voided`) | Build a **webhook event store** as the reconciliation source of truth; `listTransactions` is an adapter over it |

## What IS documented and buildable today

- **Auth:** `Authorization: Bearer sk_test_*` (sandbox) / `sk_live_*`. Base `https://api.agentcard.sh`. Units: **cents**.
- `POST /api/v1/cardholders` → `{ id: "ch_…" }` (firstName, lastName, dateOfBirth, phoneNumber, email; 409 on dup email)
- `POST /api/v1/cardholders/{id}/payment-method/setup` → `{ checkoutUrl, stripeSessionId }`
- `GET  /api/v1/cardholders/{id}/payment-method/status` → `{ hasPaymentMethod, paymentMethodId }`
- `POST /api/v1/cards` `{ amountCents, cardholderId }` → `{ id, last4, expiry, spendLimitCents, balanceCents, status:"OPEN" }` (422 → `setupUrl`)
- `GET  /api/v1/cards/{id}/details` → `{ pan, cvv, expiry, last4 }` (audit-logged)
- `DELETE /api/v1/cards/{id}` → `{ status:"CLOSED" }` (idempotent, releases hold)
- `GET  /api/v1/cards?status=&cardholderId=&limit=&offset=` (status ∈ OPEN|IN_USE|CLOSED|PAUSED)
- `POST /api/v1/webhook_endpoints` `{ url, enabled_events }` → `{ whsec_… }`
- Webhook events: `card.created/updated/closed`, `cardholder.created/updated`,
  `transaction.authorized/declined/cleared/voided`, `balance.low`. Signed `AgentCard-Signature` header.

## Net effect on the build

- **Buildable now:** the entire documented **card rail (M0)**, **Lane B** paths, the deterministic
  **router**, **vaults**, **Executor**, and the **approval/recon** state machine (with our own gate).
- **Not buildable now:** **Lane A** (needs `/buy` access + schema). Stubbed behind `FundingRail`/lane.
- **Separate surface:** **P0 machine rail** doesn't touch Agentcard at all (own x402 wallet) — deferred.

## Action before coding the client

Re-verify every TO-CONFIRM item against the integration guide at build time:
- `/buy` parameters, account-binding/connect support, user-notification routing.
- Whether a `202/approval_id` flow or org auto-approve policy exists (it would simplify our gate).
- A list-transactions endpoint (would replace the webhook-store adapter).
- Whether the $50 org ceiling can be raised for our org.
