# Phased Build Plan — Bloon v1

> **NOTICE (2026-03):** Bloon has migrated to a credit-card-only architecture. The blockchain/USDC/wallet/x402 system has been completely removed. The following phases are **superseded** and no longer applicable:
> - **Phase 2** (Wallet Management) — wallets, USDC balance, QR codes, transfers
> - **Phase 3** (x402 Detection & Payment) — x402 route detection, crypto payments
> - **Phase 7** (Coinbase Onramp + E2E on Mainnet) — Coinbase Onramp, mainnet USDC, on-chain verification
>
> Phases 1, 4, 5, and 6 remain relevant but references to wallet_id, USDC transfers, x402 routing, and on-chain verification within them should be disregarded. Purchases are now executed exclusively via browser checkout with credit card credentials filled via Playwright CDP.

Each phase has test gates. Don't proceed until all pass.

---

## Phase 1: Foundation (30 min)

Monorepo, types, JSON store, fee calculator.

### Deliverables

Scaffolded monorepo with packages: core, wallet, x402, checkout, api (stubs). All types from 09-data-models.md. Working JSON store for wallets + orders.

### Test Gate

```
[ ] pnpm install + pnpm -r build succeeds
[ ] store: create wallet record → read → matches
[ ] store: create order → update status → read → correct
[ ] store: persists to disk, reload returns same data
[ ] fees: calculateFee("17.99", "browserbase") === "0.36"
[ ] fees: calculateFee("0.10", "x402") === "0.002"
[ ] fees: calculateTotal("17.99", "browserbase") === "18.35"
[ ] fees: price > 25 throws PRICE_EXCEEDS_LIMIT
```

---

## Phase 2: Wallet Management (30 min)

viem wallets, USDC balance, QR codes, transfers.

### Deliverables

wallet/create.ts, wallet/balance.ts, wallet/transfer.ts, wallet/qr.ts

### Test Gate

```
[ ] createWallet("Test") returns { wallet_id, address, private_key, funding_token }
[ ] address is valid (0x, 42 chars), private_key is valid hex
[ ] No duplicate addresses across wallets
[ ] getBalance(empty_address) === "0.00"
[ ] getBalance(funded_address) returns correct amount (testnet)
[ ] generateQR(address) returns valid base64 PNG data URL
[ ] QR decodes back to the wallet address
[ ] transferUSDC(from, to, "1.00") succeeds on Base Sepolia
[ ] transferUSDC with insufficient balance returns TRANSFER_FAILED
```

---

## Phase 3: x402 Detection & Payment (45 min)

Detect x402 endpoints, pay from Bloon wallet, get response.

### Deliverables

x402/detect.ts, x402/pay.ts

### Test Gate

```
[ ] detectRoute(x402_url) → { route: "x402", requirements: {...} }
[ ] detectRoute(normal_url) → { route: "browserbase" }
[ ] detectRoute(unreachable_url) → URL_UNREACHABLE
[ ] detectRoute(402_bad_headers) → fallback to browserbase
[ ] payX402(test_endpoint) returns service response
[ ] Quote: $0.10 → total $0.102 (2% fee)
```

---

## Phase 4: Browser Checkout (1.5 hrs)

Browserbase + Stagehand + Playwright CDP credential fills + domain cache. Largest phase.

### Deliverables

checkout/task.ts, checkout/session.ts, checkout/credentials.ts, checkout/fill.ts, checkout/agent-tools.ts, checkout/discover.ts, checkout/confirm.ts, checkout/cache.ts, checkout/cost-tracker.ts, checkout/step-tracker.ts

### Test Gate — Ordered

**Baseline:**
```
[ ] createBrowserbaseSession() returns session with CDP URL
[ ] destroySession(id) succeeds
[ ] buildPlaceholders() has all x_* keys, values match .env
```

**Discovery (price extraction):**
```
[ ] discoverProduct(shopify_url) returns { name, price, method: "firecrawl" }
[ ] discoverProduct(target_url) returns { name, price }
[ ] discoverProduct(bestbuy_url) returns { name, price }
[ ] discoverProduct(amazon_url) returns { name, price }
[ ] discoverProduct(bad_url) returns QUERY_FAILED
[ ] Firecrawl pipeline: 3 retry attempts with exponential backoff
[ ] Browserbase+Gemini repair path triggers when confidence < 0.75
[ ] Parser ensemble ranks candidates correctly across sources
[ ] Shopify .json fallback populates options when LLM returns none
[ ] Variant price resolution via /scrape and /crawl
```

**Credential security:**
```
[ ] Task template contains x_card_number, NOT real number
[ ] LLM conversation log has zero real credential values
```

**Full checkout (real sites, in order):**
```
[ ] Shopify store: navigate → cart → checkout → fill → submit → confirmation
[ ] Target.com: same flow
[ ] Amazon.com: same flow (stretch)
```

**Domain cache:**
```
[ ] First visit creates ~/.bloon/cache/{domain}.json
[ ] Second visit injects cached cookies
[ ] No auth tokens in cache
```

---

## Phase 5: Buy & Confirm Orchestration (1 hr)

Wire routing, fees, USDC transfer, and execution into buy(), confirm(), and query(). Lives in a separate `packages/orchestrator` package to avoid circular dependencies between core, checkout, x402, and wallet.

### Deliverables

orchestrator/router.ts, orchestrator/query.ts, orchestrator/buy.ts, orchestrator/confirm.ts, orchestrator/receipts.ts

### Test Gate

```
[ ] buy({ url: x402_endpoint }) → order with route "x402", correct fee
[ ] buy({ url: amazon_product }) → order with route "browserbase", correct fee
[ ] buy without shipping + browser route → SHIPPING_REQUIRED
[ ] buy with shipping → uses provided shipping
[ ] buy x402 → no shipping needed
[ ] buy unfunded wallet → INSUFFICIENT_BALANCE
[ ] buy price > $25 → PRICE_EXCEEDS_LIMIT
[ ] confirm x402: transfers USDC + pays service + returns receipt with response
[ ] confirm browser: transfers USDC + checks out + returns receipt with order number
[ ] confirm expired → ORDER_EXPIRED
[ ] confirm already completed → returns existing receipt
[ ] confirm USDC sent but purchase fails → status "failed", tx_hash preserved
```

---

## Phase 6: API Server + Funding Page (45 min)

Hono routes, funding HTML page, wire everything up.

### Deliverables

api/server.ts, api/formatters.ts, api/error-handler.ts, api/routes/wallets.ts, api/routes/query.ts, api/routes/buy.ts, api/routes/confirm.ts, api/routes/fund.ts, api/index.ts

### Test Gate

```
[ ] Server starts: node packages/api/dist/index.js → listening on :3000
[ ] curl POST /api/wallets → returns wallet_id + funding_url
[ ] curl GET /api/wallets/:id → returns balance
[ ] curl POST /api/query → returns product info, options, required_fields
[ ] curl POST /api/buy → returns quote
[ ] curl POST /api/confirm → executes + returns receipt
[ ] No auth headers required on any endpoint
[ ] GET /fund/:token returns HTML page with QR code
[ ] Funding page shows live balance (polls every 10s)
[ ] Invalid wallet_id → 404 JSON error
[ ] Invalid order_id → 404 JSON error
[ ] Missing required fields → 400 JSON error
```

---

## Phase 7: Coinbase Onramp + E2E on Mainnet (2 hrs)

Integrate Coinbase Onramp into the funding page. Run full E2E flows on **Base mainnet** with real USDC.

### Prerequisites (Human)

```
[ ] CDP account created at portal.cdp.coinbase.com
[ ] CDP API key pair generated and added to .env (CDP_API_KEY_NAME, CDP_API_KEY_SECRET)
[ ] Applied for Onramp access (support.cdp.coinbase.com/onramp-onboarding)
[ ] Applied for 0% USDC fees (coinbase.com/developer-platform/developer-interest)
[ ] Domain registered on CDP Portal allow list (if using iframe)
[ ] .env switched to mainnet: NETWORK=base, BASE_RPC_URL=<mainnet RPC>, real card in CARD_*
[ ] Master wallet funded with real USDC + ETH for gas on Base mainnet
```

See `15-coinbase-onramp.md` for full Coinbase Onramp spec.

### Part A: Coinbase Onramp Integration

**Deliverables:**

api/routes/fund.ts (updated), funding page HTML (updated), core/config.ts (updated)

```
[ ] GET /fund/:token/onramp-session → generates Coinbase session token, returns { onrampUrl }
[ ] Session token contains correct wallet address + Base network + USDC asset
[ ] CDP API keys never exposed to client (server-side only)
[ ] Funding page embeds Onramp iframe/redirect alongside existing QR code
[ ] Funding page shows two paths: "Buy with card" (Onramp) and "Send USDC directly" (QR)
```

**Sandbox testing (no real money):**
```
[ ] Onramp sandbox: partnerUserRef prefixed with "sandbox-" → mock purchase succeeds
[ ] Apple Pay sandbox: useApplePaySandbox=true → fake Apple Pay popup works
[ ] Widget sandbox: Debug Menu → "Enable Mocked Buy and Send" → mock flow completes
[ ] Session token generation works with sandbox CDP credentials
```

### Part B: Mainnet Config Verification

```
[ ] NETWORK=base → viem uses Base mainnet chain
[ ] USDC contract resolves to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
[ ] x402 chain ID resolves to eip155:8453
[ ] RPC URL connects to Base mainnet (block number > 0, correct chain ID)
[ ] .env.example updated with CDP_API_KEY_NAME, CDP_API_KEY_SECRET
```

### Part C: E2E — Testnet Flows (Base Sepolia)

Run existing scenarios on testnet first to confirm nothing broke.

**Scenario A: x402 Purchase**
```
[ ] POST /api/wallets → wallet created
[ ] Human opens funding_url, sends test USDC
[ ] GET /api/wallets/:id → balance updated
[ ] POST /api/buy { x402 url } → quote with 2% fee
[ ] POST /api/confirm → receipt with service response
[ ] GET /api/wallets/:id → deposit + purchase in history
```

**Scenario B: Browser Purchase (Shopify)**
```
[ ] POST /api/buy { shopify url, shipping } → quote with 2% fee
[ ] POST /api/confirm → browser checkout, receipt with order number
[ ] GET /api/wallets/:id → balance reduced
```

**Scenario C: Shipping Prompt**
```
[ ] POST /api/buy { url, no shipping } → SHIPPING_REQUIRED
[ ] Retry with shipping → quote returned
```

**Scenario D: Repeat Domain**
```
[ ] Buy from same site (first) → cache created
[ ] Buy from same site (second) → cache injected, checkout completes
```

**Scenario E: Errors**
```
[ ] Buy $30 product → PRICE_EXCEEDS_LIMIT
[ ] Buy with $2 balance → INSUFFICIENT_BALANCE
[ ] Confirm expired order → ORDER_EXPIRED
[ ] GET /api/wallets/bad_id → WALLET_NOT_FOUND
```

### Part D: E2E — Mainnet Flows (Base)

Switch to `NETWORK=base` and run with real USDC. Use small amounts ($5-10).

**Scenario F: Coinbase Onramp Funding (mainnet)**
```
[ ] POST /api/wallets → wallet created on mainnet
[ ] Open funding page → Coinbase Onramp widget loads
[ ] Complete Guest Checkout with debit card or Apple Pay → USDC deposited
[ ] GET /api/wallets/:id → balance reflects Onramp deposit
[ ] Deposit detected via on-chain polling (no webhook needed for v1)
```

**Scenario G: x402 Purchase (mainnet)**
```
[ ] POST /api/buy { x402 url } → quote with 2% fee (mainnet pricing)
[ ] POST /api/confirm → USDC transfer on Base mainnet → receipt
[ ] Verify tx_hash on basescan.org
```

**Scenario H: Browser Purchase (mainnet, small item)**
```
[ ] POST /api/buy { shopify url, shipping } → quote with 2% fee
[ ] POST /api/confirm → real browser checkout, real order placed
[ ] Verify receipt has real order number
[ ] Verify USDC balance decreased by correct amount on basescan.org
```

### Final Checklist
```
[ ] All testnet scenarios (A-E) pass
[ ] All mainnet scenarios (F-H) pass
[ ] Coinbase Onramp sandbox tests pass
[ ] Coinbase Onramp live flow completes (mainnet)
[ ] NETWORK env var switches testnet/mainnet cleanly
[ ] USDC contract selected by network
[ ] ~/.bloon/ has 600 permissions
[ ] .env.example is complete (includes CDP keys)
[ ] Funding page works in mobile browser
[ ] Funding page shows both Onramp + QR code paths
[ ] No CDP API keys leaked to client-side
[ ] Coinbase ToS acknowledgment visible on funding page
```

---

## Summary

| Phase | What | Time | Cumulative |
|-------|------|------|-----------|
| 1 | Foundation (types, store, fees) | 30 min | 0:30 |
| 2 | Wallets (generate, balance, QR, transfer) | 30 min | 1:00 |
| 3 | x402 (detect, pay) | 45 min | 1:45 |
| 4 | Browser Checkout (Browserbase, Stagehand) | 1.5 hrs | 3:15 |
| 5 | Buy & Confirm (orchestration, routing) | 1 hr | 4:15 |
| 6 | API Server + Funding Page (Hono, HTML) | 45 min | 5:00 |
| 7 | Coinbase Onramp + E2E on Mainnet | 2 hrs | 7:00 |

**Total: ~7 hours.** Phase 4 is the wildcard.
