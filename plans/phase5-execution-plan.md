# Phase 5 Execution Plan — Buy & Confirm Orchestration

> **ARCHIVED (2026-03-19):** This plan references wallet/x402/USDC which have been removed. The orchestrator now uses credit-card-only browser checkout. See `plans/20-orchestrator.md` for the current architecture.

## Circular Dependency Solution

Spec says put files in `packages/core/src/`, but `buy.ts`/`confirm.ts` need `@bloon/wallet`, `@bloon/x402`, `@bloon/checkout` — which already depend on `@bloon/core`. Circular dep breaks the build.

**Solution:** New package `packages/orchestrator/` (`@bloon/orchestrator`).
- Depends on: `@bloon/core`, `@bloon/wallet`, `@bloon/x402`, `@bloon/checkout`
- Clean acyclic graph: `core → wallet/x402/checkout → orchestrator`
- Phase 6 API imports from `@bloon/orchestrator`

---

## Deliverables

| File | Purpose |
|------|---------|
| `packages/orchestrator/src/router.ts` | `routeOrder(url)` — wraps x402 `detectRoute()` |
| `packages/orchestrator/src/buy.ts` | `buy(input)` — validate → route → price discover → fees → balance check → create order |
| `packages/orchestrator/src/confirm.ts` | `confirm(orderId)` — expiry check → USDC transfer → execute route → receipt |
| `packages/orchestrator/src/receipts.ts` | `buildReceipt()` — standardized receipt from either route result |
| `packages/orchestrator/src/index.ts` | Barrel exports |

---

## buy() Flow

```
Input: { url, wallet_id, shipping? }

1. Validate URL
2. getWallet(wallet_id) → WALLET_NOT_FOUND if missing
3. routeOrder(url) → { route, requirements? }

If x402:
  - price = requirements.maxAmountRequired
  - name = requirements.description || hostname
  - no shipping needed

If browserbase:
  - shipping = provided || getDefaultShipping() || throw SHIPPING_REQUIRED
  - discoverPrice(url, shipping) → { name, price }

4. calculateFee(price, route) → fee (enforces $25 max)
5. calculateTotal(price, route) → total (= amount_usdc)
6. getBalance(wallet.address) → INSUFFICIENT_BALANCE if < total
7. createOrder({ status: "awaiting_confirmation", expires_at: now+300s })
8. Return order (the "quote")
```

## confirm() Flow

```
Input: { order_id }

1. getOrder(order_id) → ORDER_NOT_FOUND if missing
2. If "completed" → return existing receipt (idempotent)
3. If not "awaiting_confirmation" → throw
4. If expired → status "expired", throw ORDER_EXPIRED
5. Update status → "processing"

x402 route:
  - transferUSDC(wallet → master, FEE only)
  - payX402(url, wallet.private_key) → pays service from agent wallet via EIP-3009
  - Save tx_hash immediately

browserbase route:
  - transferUSDC(wallet → master, price + fee)
  - runCheckout({ order, shipping })
  - Save tx_hash immediately

6. Success: buildReceipt(), update → "completed"
7. Failure after USDC sent: update → "failed", tx_hash preserved, refund_status "pending_manual"
```

---

## Tests (all offline, mocked)

### buy.test.ts (8 tests)
- buy x402 URL → order with route "x402", 2% fee
- buy normal URL → order with route "browserbase", 2% fee
- buy browser + no shipping + no defaults → SHIPPING_REQUIRED
- buy browser + no shipping + env defaults → uses defaults
- buy with explicit shipping → uses provided
- buy x402 → no shipping needed
- buy unfunded wallet → INSUFFICIENT_BALANCE
- buy price > $25 → PRICE_EXCEEDS_LIMIT

### confirm.test.ts (5 tests)
- confirm x402 → USDC fee transfer + pay service → receipt with response
- confirm browser → USDC full transfer + checkout → receipt with order number
- confirm expired → ORDER_EXPIRED
- confirm already completed → returns existing receipt
- confirm USDC sent but execution fails → status "failed", tx_hash preserved

---

## Execution Steps

1. Scaffold `packages/orchestrator/` (package.json, tsconfig.json)
2. Implement `router.ts`
3. Implement `receipts.ts`
4. Implement `buy.ts`
5. Implement `confirm.ts`
6. Write `index.ts` barrel
7. Write `buy.test.ts`
8. Write `confirm.test.ts`
9. `pnpm install && pnpm -r build && pnpm test` — all existing + new tests pass
10. Update `Progress.md`
