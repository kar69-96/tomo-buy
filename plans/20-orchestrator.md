# Orchestrator Package — Business Logic Layer

The `packages/orchestrator` package is the glue between the API layer and all backend packages. It was created to solve circular dependency issues — `core` can't import from `checkout`, but the buy/confirm/query logic needs both.

## Why It Exists

Without `orchestrator`, the dependency chain would be circular:

```
core → checkout → core (circular)
```

With `orchestrator`:

```
api → orchestrator → checkout, core
```

The API routes call orchestrator functions. Orchestrator calls the right backend packages. No circular imports.

## Package Exports

```typescript
// packages/orchestrator/src/index.ts
export { buy, type BuyInput } from "./buy.js";
export { confirm, type ConfirmInput, type ConfirmResult } from "./confirm.js";
export { buildReceipt, type ReceiptInput } from "./receipts.js";
export { query, type QueryInput } from "./query.js";
```

> **Architecture note:** The `routeOrder()` function and x402 payment route have been removed. All purchases now go through credit card browser checkout.

## Functions

### `query(input: QueryInput) → QueryResponse`

Discovers product info. Recommended first step.

**Flow:**
1. Validate URL format
2. Call `discoverProduct(url)` from `@bloon/checkout` which runs the multi-tier discovery pipeline (Firecrawl → Exa.ai → scrape → Browserbase)
3. Build `required_fields` — always includes standard shipping fields (name, email, phone, street, apartment, city, state, zip, country). Adds "selections" if product has options.
4. Return `QueryResponse` with product info, options, required fields, and discovery method

### `buy(input: BuyInput) → Order`

Creates a purchase quote. Does NOT charge the card or execute the purchase.

**Flow:**
1. Validate URL format
2. Resolve shipping: use provided → fall back to .env defaults → throw `SHIPPING_REQUIRED`
3. Validate all required shipping fields are non-empty (except `apartment`)
4. Validate selections (if provided) are non-empty string key-value pairs
5. Call `discoverPrice(url, shipping)` from `@bloon/checkout`
6. Calculate fee and total
7. Create order with status `"awaiting_confirmation"`, expires in 5 minutes
8. Persist order to store

### `confirm(input: ConfirmInput) → ConfirmResult`

Executes a purchase via browser checkout with the operator's credit card.

**Flow:**
1. Look up order (throws `ORDER_NOT_FOUND`)
2. If already completed → return existing receipt (idempotent)
3. Must be `"awaiting_confirmation"` (throws `ORDER_INVALID_STATUS`)
4. Check expiry (throws `ORDER_EXPIRED`, updates status)
5. Update status → `"processing"`
6. Call `runCheckout({ order, shipping, selections })`
7. Build receipt from checkout result (order_number, session_id)
8. Update status → `"completed"`, save receipt
9. **On error:** Update status → `"failed"`, save error details.

### `buildReceipt(input: ReceiptInput) → Receipt`

Creates a receipt from checkout results.

**Fields:** product name, merchant (hostname), price, fee, total_paid, timestamp, `order_number`, `browserbase_session_id`

## Dependencies

```
@bloon/orchestrator
  ├── @bloon/core       (types, store, fees, config, error codes)
  └── @bloon/checkout   (discoverProduct, discoverPrice, runCheckout)
```

## Key Design Decisions

1. **Separate package, not in core** — avoids circular imports while keeping business logic centralized
2. **Idempotent confirm** — re-confirming a completed order returns the existing receipt
3. **Selections validated** — non-empty string keys and values only
4. **Standard shipping fields always included** — query response always tells the agent what fields are needed
5. **Credit card only** — all purchases go through browser checkout with the operator's card configured in `.env`

## Files

| File | Purpose |
|------|---------|
| `query.ts` | Product discovery orchestrator |
| `buy.ts` | Quote generation with validation |
| `confirm.ts` | Checkout execution + receipt generation |
| `receipts.ts` | Receipt builder |
| `index.ts` | Re-exports |
