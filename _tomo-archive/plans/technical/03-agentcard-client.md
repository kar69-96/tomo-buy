# Agentcard Client (documented REST API)

> **Code to the docs, not the spec.** Several spec §1 claims don't hold (see
> `../spec/01-reality-reconciliation.md`). This file is the concrete client contract for `AgentcardRail`.

## 1. Base + auth + units

- **Base URL:** `https://api.agentcard.sh` (same for test and live)
- **Auth header:** `Authorization: Bearer sk_test_…` (sandbox) / `sk_live_…` (production)
- **Content-Type:** `application/json`
- **Units:** **cents** everywhere (`amountCents: 2500` = $25.00; responses use `balanceCents`, `spendLimitCents`)
- **Keys** are shown once at creation and cannot be retrieved again. Store via secret manager / `.env` (never commit).

## 2. Endpoints

### Create cardholder — one per end user
```
POST /api/v1/cardholders
{ "firstName", "lastName", "dateOfBirth" (ISO), "phoneNumber", "email" (unique per org) }
→ { "id": "ch_abc123", ...submittedFields, timestamps }
Errors: 400 invalid · 409 duplicate email
```

### Attach payment method (one-time, human)
```
POST /api/v1/cardholders/{cardholderId}/payment-method/setup
(no request body)
→ { "checkoutUrl": "<Stripe checkout>", "stripeSessionId": "..." }
Flow: redirect the user to checkoutUrl; the method auto-saves after completion.
```
> Note: endpoint is **singular** `payment-method` (spec said plural). Backed by **Stripe** checkout.

### Verify payment-method status
```
GET /api/v1/cardholders/{cardholderId}/payment-method/status
→ { "hasPaymentMethod": boolean, "paymentMethodId"?: string }
```

### Create card — single-use, places the hold
```
POST /api/v1/cards
{ "amountCents": integer (min 100/$1, max 5000/$50 default), "cardholderId" }
→ { "id", "last4", "expiry", "spendLimitCents", "balanceCents", "status": "OPEN" }
Errors: 400 invalid amount · 402 payment declined · 404 cardholder missing
        · 422 no payment method (response includes "setupUrl")
```

### Get card credentials (PAN/CVV) — trusted-side only, audit-logged
```
GET /api/v1/cards/{cardId}/details
→ { "pan", "cvv", "expiry", "last4", balances, status }
"All card credential access is logged in the audit trail."
```
> This response goes **only** to the Executor's page-fill path. Never to the LLM, never to logs.

### Close card — idempotent, releases hold
```
DELETE /api/v1/cards/{cardId}
→ { "id", "status": "CLOSED" }
Idempotent; releases held funds. Call on ABANDONED to avoid dangling holds (§8).
```

### List cards
```
GET /api/v1/cards?status=OPEN&cardholderId=ch_abc123&limit=10&offset=0
status ∈ OPEN | IN_USE | CLOSED | PAUSED ; limit 1–100 (default 50)
→ { "cards": [...], "total", "limit", "offset" }
```

### Subscribe webhooks
```
POST /api/v1/webhook_endpoints
{ "url", "enabled_events": ["card.*", "transaction.*", ...] }   // wildcards supported
→ { signing secret "whsec_…" }   // shown once only
```

## 3. Webhook events + signature verification

**Event types:** `card.created`, `card.updated`, `card.closed`, `cardholder.created`,
`cardholder.updated`, `transaction.authorized`, `transaction.declined`, `transaction.cleared`,
`transaction.voided`, `balance.low`.

**Delivery:** signed JSON POST with a timestamped `AgentCard-Signature` header.

**Verify every webhook:** recompute the HMAC over the raw body with the `whsec_` secret and
constant-time compare against the header before trusting the payload. Reject on mismatch. Persist
verified events into the **webhook event store** (the reconciliation source of truth, §8).

## 4. Lifecycle: hold → capture → release

1. **Attach** — user saves a real card once via the Stripe `checkoutUrl`. *We never see the PAN.*
2. **Hold** — `POST /api/v1/cards` places an authorization hold for `amountCents` on the attached method.
3. **Capture** — the merchant charges the single-use card → funds captured. Observe via
   `transaction.authorized` → `transaction.cleared` webhooks.
4. **Release** — on abandon, `DELETE /api/v1/cards/{id}` releases the hold. Single-use means a spent
   card fails closed on any retry — rely on this as the idempotency backstop (§8).

## 5. Error handling

- `409` duplicate email → treat as "cardholder exists", fetch/reuse.
- `422` no payment method → surface `setupUrl` to the user (attach step not done).
- `402` declined → propagate to the state machine as `DECLINED`; do not retry blindly.
- All non-2xx → typed errors in `packages/core`'s error hierarchy; never swallow.

## 6. TO-CONFIRM (not in public docs)

- **`/buy` MCP tool** — not documented. Lane A is **deferred**; `BuyToolRail` is a stub.
- **`202 + approval_id` approval mechanism** — not documented. **We own the human approval gate**
  (Temporal + UI, §8); it is not an Agentcard API feature.
- **List-transactions endpoint** — not documented; use the webhook event store adapter.
- **Org plan ceilings** beyond the $50 default — confirm with Agentcard support.
- Re-verify all of the above against `https://docs.agentcard.sh/integration-guide` before coding.
