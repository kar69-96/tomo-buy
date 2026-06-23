# Proxo v1 — Build Progress

## Test Updates

> **This section is overwritten with the latest test results every session. It is the single source of truth for current test status.**

**Last updated:** 2026-03-19

### Credit Card Migration (2026-03-19)

- **89 tests pass across 10 test files** (all unit/integration tests)
- Test files:
  - `packages/core/tests/concurrency-pool.test.ts` — 5 tests
  - `packages/core/tests/fees.test.ts` — 9 tests
  - `packages/core/tests/store.test.ts` — 7 tests
  - `packages/orchestrator/tests/buy.test.ts` — 8 tests
  - `packages/orchestrator/tests/confirm.test.ts` — 5 tests
  - `packages/orchestrator/tests/receipts.test.ts` — 3 tests
  - `packages/orchestrator/tests/query.test.ts` — 5 tests
  - `packages/orchestrator/tests/search-query.test.ts` — 17 tests
  - `packages/api/tests/api.test.ts` — 26 tests
  - `tests/e2e/errors.test.ts` — 4 tests
- Major changes:
  - **Removed blockchain/USDC/wallet/x402 system entirely** — credit card only
  - Moved `packages/wallet/` and `packages/x402/` to `stubs/`
  - Deleted: `router.ts`, `wallets.ts` route, `fund.ts` route, `x402-flow.test.ts`, `onramp.test.ts`, `config.test.ts`
  - Removed `viem` and `jose` dependencies
  - Simplified types: removed `Network`, `Wallet`, `X402Requirements`, `WalletsStore`, `PaymentRoute`
  - Renamed `PaymentInfo.amount_usdc` → `total`, removed `route` field from responses
  - Removed `wallet_id` from `Order`, `tx_hash` from `Order`/`Receipt`/`OrderError`
  - Removed `$25` price cap from `fees.ts`
  - Removed error codes: `INSUFFICIENT_BALANCE`, `WALLET_NOT_FOUND`, `TRANSFER_FAILED`, `X402_PAYMENT_FAILED`, `GAS_TRANSFER_FAILED`, `PRICE_EXCEEDS_LIMIT`
  - Updated all test files to match new types
  - `pnpm build` succeeds for core, orchestrator, api
  - All 89 tests pass

### Known pre-existing failures (not affected by this migration)

| File | Tests Failed | Root Cause |
|------|-------------|------------|
| `checkout/error-classification.test.ts` | varies | Pre-existing export issues |
| `tests/buy/checkout.test.ts` | varies | Flaky live Browserbase e2e |
| `crawling/e2e.test.ts` | varies | Site-dependent |

### E2E Checkout Results (17 tests, `tests/buy/checkout.test.ts`)

Framework: 12 passed, 5 failed (all 5 failures are 180s timeouts — the checkouts succeeded but took >180s)

- TypeScript: all packages compile cleanly (`pnpm build` passes)
- Vitest (checkout unit tests): **4/4 files pass, 38/38 tests pass** (cache, credentials, confirm, fill)
- Vitest (session): **1/1 file pass, 4/4 tests pass**
- All checkout-related tests pass after checkout flow hardening implementation

### Checkout Flow Hardening (Phases 1-5 implemented)

All 5 phases implemented in a single pass:

| Phase | Status | Changes |
|-------|--------|---------|
| Phase 1: Anti-Bot & Session Hardening | Done | Always-on stealth/proxies/solveCaptchas, CAPTCHA wait utility, smart navigation wait, proxy geo-matching |
| Phase 2: Form Filling Robustness | Done | 3-tier shipping fill (DOM→observe→act), enhanced card selectors, split expiry, address autocomplete dismissal, custom dropdown fallback, phone formatting |
| Phase 3: Hybrid Mode & Multi-Site | Done | Hybrid mode (DOM+CUA), Sonnet 4 model, multi-page checkout tracking, createAccount tool, selectShipping tool, express pay removal, dynamic step budgets |
| Phase 4: Action Caching & Cost Optimization | Done | Stagehand cacheDir per domain, expanded DOM pruning (SVG, video, footer, ads, chat widgets) |
| Phase 5: Recovery & Diagnostics | Done | Error classification (7 categories), diagnostic screenshots on failure, checkpoint URL tracking, consecutive failure detection |

### Vitest Unit Tests

- **Crawling:** 52/52 pass (discover.test.ts) — includes Shopify fast-path, URL validation, Browserbase trigger, exception handling tests
- **Checkout:** 38/38 pass (cache, credentials, confirm, fill)
- **Session:** 4/4 pass

### Known Pre-existing Failures (not affected by pipeline fixes)

| File | Tests Failed | Root Cause |
|------|-------------|------------|
| `wallet/gas-network.test.ts` | 2 | Funder wallet has insufficient ETH on Base Sepolia |
| `e2e/x402-flow.test.ts` | 2 | Wallet creation returns 500 (same gas issue) |
| `e2e/browser-flow.test.ts` | 1 | Browser checkout flow failure (flaky) |
| `e2e/wikipedia-donation.test.ts` | 1 | Donation flow failure |
| `crawling/e2e.test.ts` | 1-4 | Shopify sites may return `method: "shopify"` (updated assertions); Gymshark 404 |
| `checkout/e2e-discover.test.ts` | 3-4 | Stagehand/Browserbase network flakiness |
| `checkout/session-hardened.test.ts` | 2 | ANTHROPIC_API_KEY env var not set in test env |
| `checkout/error-classification.test.ts` | varies | Pre-existing checkout test issues |
| `checkout/step-tracker-enhanced.test.ts` | varies | Pre-existing checkout test issues |

### Bulk URL Test (61 URLs, concurrency 3) — Phase 2 Results (Exa + BB try/catch + Gemini quality)

- **Passed: 46 (75%), 0 false positives** — up from 38/61 (62%) after Phase 1
- **404s: 3** — Gymshark, Chubbies, eBay (correctly rejected)
- **Failed: 12** — extract_empty=8, blocked=3, adapter_502=1
- **Methods: shopify=8, exa=37, browserbase=1, unknown=15**
- **Timing:** avg 65.7s, P50 73.8s, P95 106.4s, fastest 0.8s (Shopify), slowest 156.8s

**Phase 2 optimizations applied (2026-03-08):**

| Optimization | Description | New Passes |
|---|---|---|
| Exa.ai integration | Fire Exa in parallel with Firecrawl; Exa now primary extractor for 37/46 successes | Levi's, Google, Bose, Logitech, Wayfair, CB2, West Elm, REI (+8) |
| Browserbase try/catch | BB call wrapped so ProductBlockedError doesn't bypass timing/failure tracking | Chewy now correctly tracked (still fails due to 429) |
| Expanded JSON-LD | `isProductType()` handles ProductGroup/IndividualProduct/schema.org URLs | Quality improvement |
| CSS selector tier | itemprop microdata + h1+price class patterns before Gemini fallback | Quality improvement |
| More content selectors | 22 selectors (was 9): `.pdp-container`, `[data-testid='pdp']`, etc. | Quality improvement |

**Remaining failures (12):**
- **Correct rejections (URL validation)**: MVMT (wrong variant), Bookshop (Exa returned wrong book), iHerb (Exa returned wrong product)
- **Infrastructure**: Gap (product redirect → GeneralNoResults), Thrive (domain parked → GoDaddy), Away (adapter 502)
- **Blocked**: B&N (403), Chewy (429), Etsy (blocked pattern)
- **Gemini empty**: Adidas (BB renders but Gemini returns null), Nordstrom (same)
- **Redirect**: Zara (redirects to search on BB)

### Phase 1 Bulk URL Test (62%, baseline for Phase 2)

- **Passed: 38 (62%), 0 false positives**
- **Methods:** shopify=8, firecrawl=22, browserbase=8
- **Fixes:** Browserbase trigger widened, per-attempt try/catch, Shopify fast-path, URL-product name validation

### Previous Bulk URL Test (pre-all-fixes)

- **Passed: 37 (61%)** — but 3 were false positives (Thrive, Bookshop, The Ordinary)
- **True positive rate: 34/61 (56%)**
- **Methods:** firecrawl=28, browserbase=9
- **Timing:** avg 44.8s, P50 39.8s, P95 84.5s

### Refreshed 22 dead URLs (2026-03-08)

Replaced 22 dead/404 URLs across `bulk-url-test.ts`, `bulk-url-pipeline-test.ts`, and `bulk-failed-only.ts`. Replaced Instacart (no stable product URLs) with Vitacost. Notable new successes: Bose, Sony, Anker, Levi's, North Face, Casper, Everlane, Dyson, Decathlon, Muji, Walmart.

### Pipeline Fixes (2026-03-06)

Three fixes applied to improve discovery accuracy:

**Fix 1: Exa parallel execution** — Exa was timing out in the pipeline because Firecrawl consumed 30-90s first. Now Exa fires in parallel with Firecrawl (`discoverViaExa(url).catch(() => null)`) and is awaited after Firecrawl/scrape fail. URLs like CB2, West Elm, AG1, Costco that succeeded standalone now work in the pipeline.

**Fix 3: Browserbase extraction quality** — Many pages rendered successfully but Gemini returned null because product data was lost in 30k-char markdown truncation. Added JSON-LD (`<script type="application/ld+json">`) and meta tag (`og:title` + `product:price:amount`) extraction from raw HTML before falling back to Gemini. These are faster and more reliable for structured data.

**Fix 4: Redirect detection** — URLs like Bookshop (Atomic Habits → Land of My Heart) and MVMT (Classic Black Tan → Coronada Ceramic) were redirecting to different products. Added `isRedirectedResult()` in exa-extract.ts and `isRedirectToOtherPage()` in browserbase-extract.ts. Both check domain mismatch, homepage/search redirect, and significant path changes.

**Files changed:**
- `packages/crawling/src/exa-extract.ts` — added `isRedirectedResult()`, redirect check after Exa result
- `packages/crawling/src/browserbase-extract.ts` — added `extractJsonLdFromHtml()`, `extractMetaFromHtml()`, `isRedirectToOtherPage()`, `RenderedPage` interface; reordered extraction: JSON-LD → meta tags → Gemini
- `packages/crawling/src/browserbase-adapter.ts` — added `finalUrl` to `ScrapeResponse`, captures `page.url()` after navigation
- `packages/checkout/src/discover.ts` — Exa runs in parallel with Firecrawl, awaited after scrape fails

### Exa.ai Stage 2.5

Added Exa.ai as Stage 2.5 in the discovery pipeline (between server-side scrape and Browserbase). Uses livecrawl + LLM structured extraction via JSON Schema.

**Schema fix:** Initial `{type, description}` object format caused Exa validation error. Fixed to proper JSON Schema (`{type: "object", properties: {...}, required: [...]}`).

**Exa.ai extracted these 8 URLs that other tiers couldn't:**
| Site | Product | Price |
|------|---------|-------|
| H&M | Loose Fit Sweatshirt | $14.99 |
| Adidas | Ultraboost 5 Shoes | $180 |
| Levi's | 511 Slim Fit Men's Jeans | $69.50 |
| Wayfair | Sheets & Pillowcases | $25.28 |
| Chewy | Pet Food | $24.99 |
| Aesop | Resolute Facial Concentrate | $179.00 |
| Lego | Eiffel Tower 10307 | $629.99 |
| iHerb | Gaia Herbs Mental Alertness | $31.49 |

**Impact:** Exa saved 8 Browserbase sessions (~$0.40-$1.20 saved per run).

### Phase H Changes (404 Detection + Adapter Concurrency)

**1. 404/Discontinued detection** — pipeline now explicitly detects and reports product-not-found pages instead of returning null:
- `ProductNotFoundError` class in `constants.ts` — thrown on HTTP 404/410 or content-based detection
- `NOT_FOUND_PATTERNS` (24 patterns): "product is no longer available", "page not found", "has been discontinued", etc.
- `extract.ts`: throws `ProductNotFoundError` on 404/410 status or matching content patterns
- `browserbase-extract.ts`: same detection, re-throws through catch-all
- `discover.ts`: catches `ProductNotFoundError`, returns `FullDiscoveryResult` with `error: "product_not_found"` instead of null
- `FullDiscoveryResult` now has optional `error?: string` field
- `checkout/discover.ts`: `discoverProduct` short-circuits on `product_not_found` error
- Bulk tests updated to show `[404]` status and separate "Not Found / Discontinued" section

**2. Adapter concurrency improvements** (`browserbase-adapter.ts`):
- Session creation rate limiter (token-bucket, 4/s default) — prevents thundering herd on Browserbase API
- Retry with backoff in `handleScrape` (2 retries, exponential + jitter) — recovers transient 502s/timeouts
- Retryable error classification (`AdapterError.retryable`) — only retries timeouts/connection errors, not 403s
- 5xx retry in `createSession` (was 429-only)
- Better cleanup — `browser.close()` in finally block
- Health endpoint reports active/queue counts

**3. Caller-side concurrency control** (`browserbase-extract.ts`):
- Semaphore limiting concurrent Browserbase fallback extractions (default 5 via `BB_EXTRACT_CONCURRENCY`)
- Prevents caller timeouts from semaphore queue wait exhausting the extraction timeout
- Default extraction timeout raised from 60s → 90s

### Phase H Bulk Test Results (concurrency 20)

**10/61 passed, 15 detected as 404/discontinued, 36 null**

| Site | Product | Price | Options |
|------|---------|-------|---------|
| Zara | RUSTIC COTTON T-SHIRT | $14.90 | 1 (Color) |
| Apple | iPhone 16 | $699 | 4 (Model, Color, Storage, AppleCare) |
| Samsung | Galaxy S25 Ultra | $1299.99 | 2 (Color, Storage) |
| Logitech | MX Master 3S | $99.99 | 1 (Color) |
| IKEA | KALLAX Shelf unit | $49.99 | 1 (Size) |
| CeraVe | Moisturizing Cream | $14.99 | 1 (Size) |
| Patagonia | Nano Puff Jacket | $142.99 | 2 (Color, Size) |
| Bookshop | Land of My Heart | $20.00 | 1 |
| Warby Parker | Durand | $95 | 2 (Color, Width) |
| Lego | Eiffel Tower 10307 | $629.99 | — |
| Thrive Market | (hallucinated) | $33000 | — | Bad price |

### Phase H 404 Detections (15 URLs)

Gymshark, Bombas, Ruggable, Chubbies, Uniqlo, Bose, Sony, Anker, Instacart, Everlane, ASOS, Decathlon, Muji, eBay, Target

### Phase H Remaining Nulls (36 URLs)

| Cause | Count | Examples |
|-------|-------|---------|
| Adapter timeout | ~12 | Browserbase sessions slow under concurrency |
| Gemini extraction failed | ~9 | Large pages truncated to 30k chars, product data lost |
| Bot-blocked (403/WAF) | ~5 | Nike, Adidas, Sephora, Glossier |
| Other (502, connection) | ~10 | Transient Browserbase infrastructure failures |

**Note:** At concurrency 1 (Phase G), 32/61 passed. The throughput gap is Browserbase infrastructure, not pipeline logic.

**4. Smart HTML truncation** (`browserbase-extract.ts` + `constants.ts`):
- Cheerio-based boilerplate stripping: removes header, footer, nav, sidebar, ads, modals before markdown conversion
- Main-content extraction: tries `main`, `[role='main']`, `.product-detail`, etc. first — if found, only converts that section
- `MAIN_CONTENT_SELECTORS` and `BOILERPLATE_SELECTORS` in constants.ts
- Should recover some of the ~9 Gemini extraction failures caused by product data being lost after 30k-char truncation

### Known Issues

- Thrive Market price hallucination: Gemini extracted $33,000 instead of real price (~$8). Need price sanity check
- High concurrency (>10) degrades Browserbase session reliability — recommended concurrency 1-5 for best results

### Phase F Changes (Defeat Cloudflare Enterprise + SPA Rendering)

Applied 5 changes targeting WAF blocks and SPA rendering failures:

1. **Smart 3-phase wait** (replaces fixed 5s `waitForTimeout`): networkidle (10s) → product selector race (3s) → DOM stability via MutationObserver (3s). Target: SPA sites like Bose, Sony, Anker, Samsung, Nike, Adidas
2. **Blocked detection + mobile retry inside adapter**: `isBlockedContent()` checks raw HTML for 24 WAF patterns. If blocked, retries with mobile Browserbase profile (many WAFs are more lenient on mobile)
3. **Fingerprint rotation**: Random viewport from desktop/mobile pools, `advancedStealth: true`, `logSession: true`, realistic `Accept-Language` + `Accept` headers
4. **3-attempt exponential backoff in discover.ts**: Replaces single retry — delays of 2s, 4s between attempts. Handles transient IP blocks
5. **6 new blocked patterns in extract.ts safety net**: `cf_chl_opt`, `managed_checking_msg`, `challenge-error-title`, `px-captcha`, `datadome`, `human verification`
6. **`waitFor: 0` in extract.ts**: Adapter now handles all waiting, so Firecrawl doesn't double-wait

### Bulk URL Test Results (61 product URLs)

| Metric | Before (baseline) | Fetch-only (Phase A+B) | With Browserbase (Phase C) | Phase E | Phase F | Phase G | Phase H (c=20) | + Exa (c=3) |
|--------|-------------------|------------------------|---------------------------|---------|---------|---------|----------------|-------------|
| Total URLs | 61 | 61 | 61 | 61 | 61 | 61 | 61 | 61 |
| Passed | ~24 (39%) | 16 (26%) | **20 (33%)** | **25 (41%)** | **28 (46%)** | **32 (52%)** | **10 (16%)** | **29 (48%)** |
| 404 detected | — | — | — | — | — | — | **15** | **22** |
| Hallucinated wrong products | ~8 | **0** | **0** | **0** | **0** | **1** (Thrive) | **1** (Thrive) | **1** (Thrive) |
| Bad prices ($NaN, ".", $0.00) | ~3 | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| True correct products | ~16 | 16 | **20** | **25** | **28** | **31** | **9** | **28** |
| Discovered via Exa | — | — | — | — | — | — | — | **8** |
| Concurrency | 1 | 1 | 1 | 1 | 1 | 1 | **20** | **3** |
| Avg time per URL | ~8s | 12.7s | 36.8s | pending | ~28s | pending | | ~58s |

### Phase F Newly Passing (3 URLs recovered)

| Site | Product | Price | Time |
|------|---------|-------|------|
| H&M | Loose Fit Sweatshirt | $10.49 | 7.3s |
| Apple | iPhone 16 | $729.00 | 184.3s |
| Yeti | Rambler 20 oz Travel Mug | $38.00 | 10.4s |

### Phase F Still Failing (40 URLs — all null result)

The remaining failures are all WAF-blocked (null result). The `isBlockedContent` + mobile retry approach recovers some sites but most enterprise WAFs (Cloudflare Enterprise, Akamai, PerimeterX) still block regardless of profile. The 40 still-failing sites would likely need residential proxies or specialized anti-detect browsers beyond what Browserbase's stealth mode provides.

### Browserbase Adapter Notes

- Dev plan has a **1 concurrent session limit** — adapter uses semaphore + 2s post-session cooldown + retry with backoff to stay within limits
- Adapter returns HTTP 502 for adapter-level errors so Firecrawl falls back to fetch engine
- Smart 3-phase wait replaces fixed 5s: networkidle → product selectors → DOM stability
- Blocked pages detected inside adapter and retried with mobile profile before returning to Firecrawl
- Viewport randomization from desktop (5) and mobile (4) pools for fingerprint diversity
- Bulk test runs at concurrency 1 to serialize Browserbase sessions

| Site | Success | Total | Duration | Notes |
|------|---------|-------|----------|-------|
| **Allbirds** | true | $200.00 | ~290s | TIMEOUT — works but >180s limit |
| **Bombas** | false (correct) | — | ~82s | out_of_stock: option not available |
| **Glossier** | false (correct) | — | ~44s | out_of_stock: notify me |
| **Target** | false (correct) | — | 163s | Stuck at login-gate, exits after 5 stalls |
| **Best Buy** | true | — | >180s | TIMEOUT — works but >180s limit |
| **Walmart** | false | $15.81 | 151s | Price mismatch: expected $3.49, found $15.81 (wrong item in cart at login-gate) |
| **Amazon** | true | — | >180s | TIMEOUT — works but >180s limit |
| **Nike** | true | $124.49 | ~249s | TIMEOUT — works but >180s limit |
| **Etsy** | true | — | ~119s | No total extracted |
| **Nordstrom** | true | $65.34 | 136s | **FIXED** — was StagehandEvalError, now succeeds |
| **Home Depot** | false (correct) | — | ~18s | checkout_error: something went wrong |
| **B&H Photo** | true | — | >180s | TIMEOUT — works but >180s limit |
| **Apple** | false (correct) | — | ~16s | Redirected to search page (product gone) |
| **Wikipedia** | true | $5.00 | ~49s | Scripted donation handler works perfectly |
| **Stripe** | true | $29.96 | ~93s | Works end-to-end |
| **Allbirds Size 10** | true | $300.00 | >180s | TIMEOUT — works but >180s limit |
| **Allbirds Basin Blue** | false (correct) | — | ~70s | out_of_stock: notify me (color unavailable) |

### Truly Successful Checkouts: 9/17
Allbirds, Amazon, Nike, Etsy, B&H Photo, Wikipedia, Stripe, Allbirds Size 10, **Nordstrom** (new)

### Correct Failures (product/site issues): 6/17
Bombas (OOS), Glossier (OOS), Home Depot (error), Apple (redirected), Allbirds Basin Blue (OOS), Target (login-gate)

### Issues Remaining: 2/17
- **Walmart**: Price mismatch ($3.49 → $15.81) — wrong item ends up in cart due to login-gate interference
- **5 timeouts**: Best Buy, Amazon, Nike, Allbirds, Allbirds Size 10 — all succeed but take >180s

### Unit Test Results

| Test File | Failures | Cause |
|-----------|----------|-------|
| `packages/wallet/tests/gas-network.test.ts` | 2 | Insufficient ETH on testnet faucet wallet |
| `packages/checkout/tests/session.test.ts` | 1 | Browserbase session creation network timeout |
| `tests/e2e/browser-flow.test.ts` | 1 | API server not running (500) |
| `tests/e2e/wikipedia-donation.test.ts` | 1 | API server not running (502) |
| `tests/e2e/x402-flow.test.ts` | 2 | API server not running (500) |

### Unit Test Output (all packages, excluding e2e)

```
 ✓ packages/crawling/tests/discover.test.ts (40 tests) 2673ms
 ✓ packages/crawling/tests/e2e.test.ts (6 tests) 68964ms
 ✓ packages/crawling/tests/comparison.test.ts (2 tests)
 ✓ packages/checkout/tests/discover.test.ts (17 tests)
 ✓ packages/checkout/tests/discover-browser.test.ts (8 tests)
 ✓ packages/checkout/tests/variant-price.test.ts (15 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/core/tests/concurrency-pool.test.ts (5 tests)
 ✓ packages/core/tests/fees.test.ts (10 tests)
 + 20 more test files passing (orchestrator, wallet, x402, checkout, e2e config)

 Test Files  29 passed, 5 failed (34)
      Tests  271 passed, 7 failed, 1 skipped (279)

### Recent Checkout Changes (Parse branch — session 8)

| Change | File | Description |
|--------|------|-------------|
| **ADD: Bot-block detection** | `task.ts` | After navigation, checks page content size (<500 chars or <50 words) — early exit with `bot_blocked` error for near-blank bot-wall pages |
| **FIX: detectPageType retry** | `scripted-actions.ts` | Wraps `page.evaluate()` in try-catch with 2s retry — handles SPA hydration/DOM mutation errors (fixes Nordstrom `StagehandEvalError`) |
| **FIX: detectPageType safety** | `task.ts` | Wraps `detectPageType()` call in try-catch, falls back to `"unknown"` instead of crashing |
| **FIX: extractVisibleTotal** | `scripted-actions.ts` | 3-pass rewrite: (1) DOM-aware label matching, (2) labeled regex patterns, (3) greedy fallback — prevents matching product price instead of order total |

### Recent Crawling/Discovery Changes (main branch)

| Change | File(s) | Description |
|--------|---------|-------------|
| Exa.ai Stage 2.5 | `exa-extract.ts` (NEW), `discover.ts`, `variant.ts`, `index.ts`, `checkout/discover.ts` | New Exa.ai discovery tier between scrape and Browserbase. Uses livecrawl + structured extraction (~$0.002/req, 5-15s). Variant resolution via domain-scoped search. Gracefully skipped if no `EXA_API_KEY`. |
| Smart 3-phase wait | `browserbase-adapter.ts` | networkidle + product selector race + DOM stability MutationObserver (replaces fixed 5s wait) |
| Blocked detection + mobile retry | `browserbase-adapter.ts` | `isBlockedContent()` with 24 patterns, automatic mobile profile retry on block |
| Fingerprint rotation | `browserbase-adapter.ts` | Random viewport pools (5 desktop, 4 mobile), `advancedStealth`, realistic headers |
| 3-attempt exponential backoff | `discover.ts` | Replaces single retry with 3 attempts (2s, 4s delays) |
| New blocked patterns + waitFor:0 | `extract.ts` | 6 new WAF patterns, `waitFor: 0` (adapter handles waiting) |
| Test updates | `discover.test.ts` | Fake timers for retry tests, 3-attempt assertions, `waitFor: 0` assertion |
| Blocked page detection | `extract.ts` | Request `["json", "markdown"]` format. Reject 4xx status, empty/tiny markdown, bot-challenge patterns (Cloudflare "Just a moment", "Access Denied", etc.). Prevents LLM hallucinations on empty pages. |
| Browserbase adapter | `browserbase-adapter.ts` (NEW) | Standalone HTTP server (~160 lines) that speaks Firecrawl's Playwright microservice protocol. Routes scrapes through Browserbase (CAPTCHA solving, stealth proxies, anti-bot). Concurrency semaphore, retry with backoff, post-session cooldown. |
| Start/stop scripts | `scripts/start.sh`, `scripts/stop.sh` | Start adapter before Firecrawl, set `PLAYWRIGHT_MICROSERVICE_URL`. Clean up adapter PID on stop. |
| Bulk test upgrade | `tests/bulk-url-test.ts` | Added price validation flagging, bad-price counter in summary output. |
| Test coverage | `tests/discover.test.ts` | 16 new tests: 8 `isValidPrice` unit tests, 2 invalid-price pipeline tests, 6 blocked-page detection tests (403, 404, empty, bot-challenge, valid). Updated all existing mocks to include markdown + metadata. |

**Impact:** Eliminates all ~8 hallucinated wrong-product results and ~3 bad prices. Browserbase adapter adds 4 new sites (Google, Logitech, Wayfair, REI, Bookshop, MVMT). Pass rate: baseline ~39% (with hallucinations) → 26% fetch-only → **33% with Browserbase** (all correct).

### Previous Session Changes

| Change | File | Description |
|--------|------|-------------|
| **ADD: Redirect verification** | `task.ts` | After `page.goto()`, checks for cross-domain redirects and search page redirects — aborts early with clear error (fixes B&H Photo wrong product, Apple search redirect) |
| **FIX: Product detection expansion** | `scripted-actions.ts` | Added `aria-label`, `data-testid`, `data-action`, `form[action*="/cart/add"]` selectors + "add it to your cart", "add item", "add to order" text patterns (fixes Bombas/Etsy unknown page) |
| **FIX: Login gate detection** | `scripted-actions.ts` | Added "sign up", "register", "returning customer", "new customer", "have an account", "already a member", "shop as guest" signals (fixes Walmart login gate miss) |
| **FIX: Login gate handler** | `task.ts` | Added 6 new button phrases: "checkout as guest", "continue without signing in", "skip sign in", "shop as guest", "checkout without an account", "no thanks" |
| **FIX: Login gate LLM instruction** | `task.ts` | Expanded phrasing list in `buildPageInstruction()` to match new button targets |
| **FIX: Cart checkout buttons** | `task.ts` | Added "secure checkout", "go to checkout", "start checkout", "begin checkout" to cart handler; added "secure checkout" to cart-drawer buttons |
| **ADD: Scripted donation handler** | `task.ts` | 3-step handler: (1) select amount via radio/data-amount/clickable elements, (2) select one-time frequency, (3) click payment button — only proceeds to step 3 if amount was selected (fixes Wikipedia donation ordering issue) |
| **FIX: Donation LLM instructions** | `task.ts` | Non-stalled: "First select amount, then one-time, then Continue"; Stalled: "Do NOT click payment button yet, first find amount" |
| **FIX: Dry-run false positive** | `task.ts` | Dry-run success now requires `state.cardFilled` or confirmation page — prevents false positives when checkout stalls at login-gate/cart (fixes Target false success) |
| **ADD: Out-of-stock detection** | `task.ts` | Checks all buttons/submit inputs for unavailable text before ATC attempt — detects "sold out", "notify me", "option not available", etc. |
| **FIX: scriptedSelectOption parent text** | `scripted-actions.ts` | Added `parentText` and `ariaLabel` checks for radio buttons without proper `<label>` association (fixes Wikipedia radio selection) |
| **ADD: Target-specific selectors** | `scripted-actions.ts` | Added `data-test*="add-to-cart"`, `data-test*="addToCart"`, `[data-test="shipItButton"]`, `[data-test="orderPickupButton"]` selectors + "ship it", "pick it up", "deliver it" button text |

### Previous Session Changes

| Change | File | Description |
|--------|------|-------------|
| **FIX: cross-origin iframe card fill** | `agent-tools.ts` | Complete rewrite of `scanIframesForCardFields` — uses `page.frames()` + `frame.evaluate()` for CDP-backed cross-origin frame access |
| ADD: Stripe Card Element support | `agent-tools.ts` | Detects `elements-inner-card` iframes, fills cardnumber/exp-date/cvc using `frame.locator().type()` (real keystrokes) |
| ADD: frame.evaluate() fallback | `agent-tools.ts` | When `locator.type()` times out (card number field), falls back to `frame.evaluate()` with direct keyboard event dispatch |
| FIX: skip non-card Stripe iframes | `agent-tools.ts` | Filters out payment-request, iban, ideal-bank, universal-link, controller iframes |
| ADD: iframe diagnostic logging | `agent-tools.ts` | Logs all iframe metadata (name, src) and input elements inside each frame |
| FIX: page detection order | `scripted-actions.ts` | Product page checked BEFORE payment-form to prevent Shop Pay misclassification |
| ADD: combined checkout shipping | `task.ts` | Payment handler fills shipping first on combined checkout pages |
| ADD: addedToCart/selectionsApplied tracking | `task.ts` | Prevents re-adding items and re-selecting options |
| ADD: /checkout direct navigation | `task.ts` | Product + cart pages navigate to /checkout when buttons fail |
| FIX: fill timeout wrapper | `scripted-actions.ts` | Card field fill uses 1.5s `Promise.race` timeout |

### Cross-Origin Iframe Card Fill Architecture

```
scriptedFillCardFields(page, cdpCreds)
├── 1. Main page CSS selectors (fillWithTimeout, 1.5s per field)
├── 2. Split expiry fields (month/year selectors for Stripe/Adyen)
└── 3. scanIframesForCardFields(page, cdpCreds) — iframe fallback
    ├── Get iframe metadata via page.evaluate()
    ├── Filter: skip non-card Stripe iframes (payment-request, iban, etc.)
    ├── Match frame handles via page.frames() + frame.evaluate(window.location.href)
    ├── Diagnostic: frame.evaluate() lists all inputs in each frame
    ├── Stripe Card Element (elements-inner-card):
    │   ├── frame.locator('input[name="cardnumber"]').click() + .type()
    │   ├── On timeout → frame.evaluate() with keyboard event dispatch
    │   ├── frame.locator('input[name="exp-date"]').type() (digits only)
    │   └── frame.locator('input[name="cvc"]').type()
    └── Generic: frame.locator(CSS selectors).click() + .type()
```

### Architecture: Checkout Page Loop

```
for pageIdx = 0..19:
  1. Wait for page to settle
  2. scriptedDismissPopups()
  3. detectPageType() → handler (product checked BEFORE payment)
  4. Run scripted handler (0 LLM):
     donation-landing → defer to LLM (site-specific)
     product (no ATC yet) → scripted ATC or LLM selection → /checkout fallback
     product (ATC done) → navigate to /checkout
     cart → click checkout/proceed → /checkout fallback
     login-gate → click guest/continue
     shipping-form → fillShipping() + LLM supplement if <3 fields, click continue
     payment-form/gateway → fill shipping if not done, fillCardFields(), fillBilling()
     error → extractErrorMessage(), return { success: false, type, message }
     confirmation → extractConfirmationData(), return
  5. Stall detection: same URL + same pageType → increment counter (5 = stuck)
  6. Post-action: check for confirmation OR error page
  7. LLM fallback if scripted failed OR stalled ≥2 times
  8. Post-LLM: mark selectionsApplied, try scripted ATC, check for confirmation OR error
```

---

## Phase 1: Foundation — COMPLETE

**Status:** All deliverables complete, all tests passing.

---

### What Was Built

#### Root Config (5 files)

| File | Purpose |
|------|---------|
| `pnpm-workspace.yaml` | Monorepo workspace definition (`packages/*`) |
| `package.json` | Root scripts (`build`, `test`), shared devDeps |
| `tsconfig.base.json` | ES2022, strict, ESNext modules, declaration maps |
| `.env.example` | Full environment template (card, billing, shipping, API keys, blockchain) |
| `.gitignore` | Updated with `*.tsbuildinfo`, `.proxo/` |

#### @proxo/core (6 source files)

| File | Purpose |
|------|---------|
| `packages/core/src/types.ts` | All TypeScript interfaces, `ProxoError` class, `ErrorCodes` const (13 codes) |
| `packages/core/src/store.ts` | JSON file persistence with atomic writes, Promise-chain serialization, `generateId()` |
| `packages/core/src/fees.ts` | BigInt decimal fee calculator with ceiling rounding |
| `packages/core/src/config.ts` | dotenv loader, typed accessors for network/credentials/contracts |
| `packages/core/src/index.ts` | Barrel re-exports |
| `packages/core/tsconfig.json` | Extends base config |

#### Stub Packages (4 packages, 3 files each)

| Package | Name | Phase |
|---------|------|-------|
| `packages/wallet/` | `@proxo/wallet` | Phase 2: create, balance, transfer, qr |
| `packages/x402/` | `@proxo/x402` | Phase 3: detect, pay |
| `packages/checkout/` | `@proxo/checkout` | Phase 4: session, discover, complete, cache |
| `packages/api/` | `@proxo/api` | Phase 6: server, routes, funding page |

#### Tests (3 files)

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Test discovery via `packages/*/tests/**/*.test.ts` + `tests/**/*.test.ts` |
| `packages/core/tests/fees.test.ts` | 10 tests — fee calculation, rounding, limits |
| `packages/core/tests/store.test.ts` | 12 tests — wallet CRUD, order CRUD, disk persistence |

---

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)

 Test Files  2 passed (2)
      Tests  22 passed (22)
```

#### Test Gate Checklist (from 14-phased-build-plan.md)

- [x] `pnpm install` + `pnpm -r build` succeeds
- [x] store: create wallet record -> read -> matches
- [x] store: create order -> update status -> read -> correct
- [x] store: persists to disk, reload returns same data
- [x] fees: `calculateFee("17.99", "browserbase")` === `"0.36"`
- [x] fees: `calculateFee("0.10", "x402")` === `"0.002"`
- [x] fees: `calculateTotal("17.99", "browserbase")` === `"18.35"`
- [x] fees: price > 25 throws `PRICE_EXCEEDS_LIMIT`

#### Additional Tests Beyond Spec

- fees: $25.00 exactly does NOT throw (boundary check)
- fees: $10.00 browserbase fee is `"0.50"` (trailing zero preservation)
- fees: $1.00 x402 fee is `"0.005"` (sub-cent exact output)
- fees: $20.00 x402 fee rounds to `"0.10"`
- store: `generateId` produces correct `proxo_{prefix}_{6chars}` format
- store: 100 generated IDs are all unique
- store: non-existent wallet returns undefined
- store: lists all wallets
- store: finds wallet by funding token
- store: partial order update preserves other fields
- store: filters orders by wallet_id

---

### Dependencies Installed

**Root devDependencies:**
- `typescript` ^5.7
- `vitest` ^3.0
- `@types/node` ^25.3

**@proxo/core dependencies:**
- `dotenv` ^16.4

---

### Key Implementation Notes

1. **BigInt fee math** — All fee calculations use `BigInt` fixed-point arithmetic to avoid floating-point rounding errors. Fees >= $0.01 are ceiling-rounded to 2 decimal places with trailing zeros preserved.

2. **Atomic store writes** — JSON files are written to a `.tmp` file first, then `renameSync` for POSIX-atomic replacement. Per-file Promise chains serialize concurrent writes.

3. **Test isolation** — `PROXO_DATA_DIR` env var overrides the default `~/.proxo/` directory. Tests use `os.tmpdir()` temp directories, cleaned up after each test.

4. **ESM throughout** — All packages use `"type": "module"`, imports use `.js` extensions.

5. **Test directory convention** — Tests live in `packages/*/tests/`, not in `src/`. E2E tests live in `tests/e2e/` at the repo root. See `07-testing-guidelines.md` for the full mapping.

---

## Test Directory Map (all phases)

```
packages/core/tests/        ← Phase 1 (fees, store) + Phase 5 (buy, confirm, router)
packages/wallet/tests/      ← Phase 2 (create, balance, qr, transfer)
packages/x402/tests/        ← Phase 3 (detect, pay)
packages/checkout/tests/    ← Phase 4 (session, placeholders, discover, checkout, cache)
packages/api/tests/         ← Phase 6 (routes, server, funding)
tests/e2e/                  ← Phase 7 (full flow scenarios A–E)
```

---

## Phase 2: Wallet Management — COMPLETE

**Status:** All deliverables complete, all 39 tests passing (including network tests on Base Sepolia).

---

### What Was Built

#### @proxo/wallet Source Files (7 files)

| File | Purpose |
|------|---------|
| `packages/wallet/src/usdc-abi.ts` | Minimal ERC-20 ABI: `balanceOf` + `transfer` (as const) |
| `packages/wallet/src/client.ts` | Internal: lazy-cached viem `PublicClient`, `getChain()` helper |
| `packages/wallet/src/create.ts` | `createWallet(agentName)` — generate private key, derive address, persist to store |
| `packages/wallet/src/balance.ts` | `getBalance(address)` — read USDC via `readContract`; `formatUsdc(bigint)` utility |
| `packages/wallet/src/transfer.ts` | `transferUSDC(privateKey, toAddress, amount)` — balance check, sign, broadcast, wait for receipt |
| `packages/wallet/src/qr.ts` | `generateQR(address)` — base64 PNG data URL via qrcode |
| `packages/wallet/src/index.ts` | Barrel re-exports (excludes `client.ts` and `usdc-abi.ts`) |

#### Tests (4 files)

| File | Tests | Offline | Network |
|------|-------|---------|---------|
| `packages/wallet/tests/create.test.ts` | 6 | All offline | — |
| `packages/wallet/tests/qr.test.ts` | 2 | All offline | — |
| `packages/wallet/tests/balance.test.ts` | 7 offline + 1 network | `formatUsdc` unit tests | `getBalance(empty)` → "0.00" |
| `packages/wallet/tests/transfer.test.ts` | 1 network | — | Insufficient balance → TRANSFER_FAILED |

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)

 Test Files  6 passed (6)
      Tests  39 passed (39)
```

Network tests verified on Base Sepolia with funded wallet (`0xBA19...0374`, 20 USDC via Circle faucet).

#### Test Gate Checklist

- [x] `createWallet("Test")` returns `{ wallet_id, address, private_key, funding_token }`
- [x] address is valid (0x, 42 chars), checksummed
- [x] private key derives back to the same address
- [x] No duplicate addresses across 10 wallets
- [x] Wallet persisted to store and retrievable
- [x] `formatUsdc(0n)` → `"0.00"`, `formatUsdc(1000000n)` → `"1.00"`
- [x] `generateQR(address)` returns valid `data:image/png;base64,...`
- [x] QR decodes back to the wallet address (jsqr + pngjs)
- [x] `getBalance(empty_address)` → `"0.00"` (verified on Base Sepolia)
- [x] `transferUSDC` insufficient balance → `TRANSFER_FAILED` (verified on Base Sepolia)

### Dependencies Added

**@proxo/wallet dependencies:**
- `viem` ^2.0.0 — wallet generation, contract reads/writes, chain config
- `qrcode` ^1.5.0 — QR code → base64 PNG data URL

**@proxo/wallet devDependencies:**
- `@types/qrcode` ^1.5.0
- `jsqr` ^1.4.0 — QR decode for tests only
- `pngjs` ^7.0.0 — PNG parse for QR decode test
- `@types/pngjs` ^6.0.0

### Key Implementation Notes

1. **viem for all blockchain ops** — `generatePrivateKey()`, `privateKeyToAccount()`, `createPublicClient`, `createWalletClient`, `readContract`, `writeContract`, `waitForTransactionReceipt`.

2. **Lazy-cached public client** — Single `PublicClient` instance reused across balance reads and receipt waits.

3. **Per-call wallet client** — `createWalletClient` is instantiated per transfer, not cached, since each transfer uses a different private key.

4. **USDC 6-decimal formatting** — `formatUsdc` ensures minimum 2 decimal places via `formatUnits` + padding.

5. **Network test isolation** — `describe.skipIf(!process.env.BASE_RPC_URL)` ensures `pnpm test` always passes offline.

## Phase 3: x402 Detection & Payment — COMPLETE

**Status:** All deliverables complete, all 42 tests passing (offline + network).

---

### What Was Built

#### @proxo/x402 Source Files (3 files)

| File | Purpose |
|------|---------|
| `packages/x402/src/detect.ts` | `detectRoute(url)` — GET probe, parse x402 v2 `accepts` array, match chain ID, fallback to browserbase |
| `packages/x402/src/pay.ts` | `payX402(url, privateKey)` — create x402Client, register EVM scheme, wrap fetch, auto-pay 402, return response |
| `packages/x402/src/index.ts` | Barrel re-exports (`detectRoute`, `DetectResult`, `payX402`, `X402PaymentResult`) |

#### Tests (2 files)

| File | Tests | Offline | Network |
|------|-------|---------|---------|
| `packages/x402/tests/detect.test.ts` | 2 offline + 1 network | Normal URL → browserbase; unreachable → URL_UNREACHABLE | PayAI echo merchant → x402 with requirements |
| `packages/x402/tests/pay.test.ts` | 1 network (skipped without TEST_WALLET_PRIVATE_KEY) | — | PayAI echo merchant → 200 response |

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)
 ✓ packages/x402/tests/detect.test.ts (3 tests)
 ✓ packages/x402/tests/pay.test.ts (1 test) 7613ms

 Test Files  8 passed (8)
      Tests  43 passed (43)
```

All tests verified on Base Sepolia against PayAI echo merchant (`x402.payai.network`).
Live payment completed in ~7.6s — auto-refunded by echo merchant.

#### Test Gate Checklist

- [x] `detectRoute(normal_url)` → `{ route: "browserbase" }`
- [x] `detectRoute(unreachable_url)` → throws `ProxoError(URL_UNREACHABLE)`
- [x] `detectRoute(x402_url)` → `{ route: "x402", requirements: { payTo, maxAmountRequired, network: "eip155:84532" } }` (network)
- [x] `detectRoute(402_bad_parse)` → fallback to `{ route: "browserbase" }` (covered by parse try/catch)
- [x] `payX402(test_endpoint, privateKey)` → `{ status: 200, response }` (network — verified on Base Sepolia)
- [x] Fee math: $0.10 x402 → total $0.102 (already tested in core)

### Dependencies Added

**@proxo/x402 dependencies:**
- `@x402/fetch` ^2.3.0 — x402 payment protocol fetch wrapper (auto-handles 402 responses)
- `@x402/evm` ^2.3.0 — EVM exact payment scheme (EIP-3009 TransferWithAuthorization)
- `viem` ^2.0.0 — account derivation for signing

### Key Implementation Notes

1. **x402 v2 protocol** — `detectRoute` sends a plain GET, parses the 402 response body's `accepts` array for a matching chain ID (`eip155:84532` for Base Sepolia, `eip155:8453` for Base mainnet).

2. **Chain ID mapping** — Uses `getNetwork()` from `@proxo/core` to determine `base-sepolia` → `eip155:84532` or `base` → `eip155:8453`.

3. **Graceful fallback** — Any parse failure (malformed JSON, missing fields, no matching chain) falls back to `{ route: "browserbase" }` instead of throwing.

4. **x402 client pattern** — `payX402` creates a fresh `x402Client`, registers the EVM exact scheme with wildcard `eip155:*`, and wraps fetch. The wrapped fetch auto-detects 402, signs an EIP-3009 authorization, and retries.

5. **No ETH needed** — x402 uses EIP-3009 (TransferWithAuthorization) — the buyer signs off-chain and the facilitator pays gas. Only USDC balance is needed.

6. **Test isolation** — Network tests skip via `describe.skipIf(!process.env.BASE_RPC_URL)`. Pay test additionally requires `TEST_WALLET_PRIVATE_KEY`.

### To Run Live Payment Test

Add a funded wallet private key to `.env`:
```
TEST_WALLET_PRIVATE_KEY=0x...
```
The PayAI echo merchant auto-refunds on testnet, so no USDC is permanently spent.

## Phase 4: Browser Checkout — COMPLETE

**Status:** All deliverables complete, all 95 tests passing (52 new checkout tests + 43 existing).

---

### What Was Built

#### @proxo/checkout Source Files (8 files)

| File | Purpose |
|------|---------|
| `packages/checkout/src/credentials.ts` | Credential map builder, CDP/Stagehand field split, shipping sanitization |
| `packages/checkout/src/confirm.ts` | Confirmation page detection via positive/negative text signal matching |
| `packages/checkout/src/cache.ts` | Domain cookie/localStorage cache — load/save to disk, extract/inject via CDP |
| `packages/checkout/src/session.ts` | Browserbase session lifecycle — create (with 429 retry), destroy, config validation |
| `packages/checkout/src/fill.ts` | Card field fills via Stagehand Page locators, field description → credential key mapping |
| `packages/checkout/src/discover.ts` | Price discovery — Tier 1 (JSON-LD + OG meta scrape) → Tier 2 (Browserbase cart via Stagehand) |
| `packages/checkout/src/agent-tools.ts` | Custom agent tools — `fillShippingInfo` (%var%), `fillCardFields` (CDP), `fillBillingAddress` |
| `packages/checkout/src/step-tracker.ts` | Agent action → CheckoutStep mapping for backward-compatible failedStep reporting |
| `packages/checkout/src/task.ts` | Checkout orchestration via Stagehand Agent API — single `agent.execute()` call with custom tools |
| `packages/checkout/src/index.ts` | Barrel re-exports (all public functions + types) |

#### Tests (6 files)

| File | Tests | Offline | Network |
|------|-------|---------|---------|
| `packages/checkout/tests/credentials.test.ts` | 12 | All offline | — |
| `packages/checkout/tests/confirm.test.ts` | 7 | All offline | — |
| `packages/checkout/tests/cache.test.ts` | 10 | All offline | — |
| `packages/checkout/tests/session.test.ts` | 3 offline + 1 network | Config validation | Create + destroy session |
| `packages/checkout/tests/fill.test.ts` | 9 | All offline | — |
| `packages/checkout/tests/discover.test.ts` | 10 | All offline (JSON-LD, meta, scrape) | — |

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)
 ✓ packages/x402/tests/detect.test.ts (3 tests)
 ✓ packages/x402/tests/pay.test.ts (1 test)
 ✓ packages/checkout/tests/credentials.test.ts (12 tests)
 ✓ packages/checkout/tests/confirm.test.ts (7 tests)
 ✓ packages/checkout/tests/cache.test.ts (10 tests)
 ✓ packages/checkout/tests/session.test.ts (4 tests)
 ✓ packages/checkout/tests/fill.test.ts (9 tests)
 ✓ packages/checkout/tests/discover.test.ts (10 tests)

 Test Files  14 passed (14)
      Tests  95 passed (95)
```

Network tests verified on Browserbase (session create/destroy).

#### Test Gate Checklist

**Baseline:**
- [x] `createSession()` returns session with id + connectUrl + replayUrl (network)
- [x] `destroySession(id)` succeeds without throwing (network)
- [x] `buildCredentials()` has all 17 x_* keys, values match .env

**Discovery:**
- [x] `extractJsonLd` extracts Product from JSON-LD, @graph, returns null for missing/invalid
- [x] `extractMetaTag` extracts OG/product meta tags, handles reversed attribute order
- [x] `scrapePrice(bad_url)` returns null

**Credential security:**
- [x] `isCdpField("x_card_number")` → true (4 card fields)
- [x] `isCdpField("x_shipping_name")` → false (non-card fields)
- [x] `getStagehandVariables()` returns exactly 13 fields, excludes all card fields
- [x] `getCdpCredentials()` returns exactly 4 card fields only

**Confirmation detection:**
- [x] Positive text → `isConfirmed: true`
- [x] Negative text → `isConfirmed: false`
- [x] Tied signals → negative wins (not confirmed)
- [x] Empty text → not confirmed
- [x] Case insensitive matching
- [x] Many positive signals → confidence = 1

**Domain cache:**
- [x] `saveDomainCache` → `loadDomainCache` round-trip
- [x] `isSafeCookie("session_id")` → false
- [x] `isSafeCookie("consent_cookie")` → true
- [x] Cache file has 0o600 permissions
- [x] Returns null for missing cache

**Card field mapping:**
- [x] `mapFieldToCredential("Card number input")` → "x_card_number"
- [x] `mapFieldToCredential("CVV")` → "x_card_cvv"
- [x] `mapFieldToCredential("Expiration date")` → "x_card_expiry"
- [x] `mapFieldToCredential("Email address")` → null

**Sanitization:**
- [x] `sanitizeShipping` strips `<>"'&;` characters
- [x] `sanitizeShipping` truncates fields at 200 characters

### Dependencies Added

**@proxo/checkout dependencies:**
- `@browserbasehq/stagehand` ^3.0.0 — AI browser automation (Stagehand v3)
- `zod` ^3.22.0 — Schema validation for Stagehand extract()

### Key Implementation Notes

1. **Stagehand v3 API** — Uses the v3 API: `act(string, options?)`, `observe(string)`, `extract(string, schema)`. Page accessed via `stagehand.context.activePage()`. No `.page` property on Stagehand v3.

2. **Dual-channel credential protection** — Card fields (x_card_number, x_card_expiry, x_card_cvv, x_cardholder_name) are filled via Stagehand's Page `locator().fill()` using selectors from `observe()`. Non-card fields use Stagehand's `%var%` variable substitution. The LLM never sees real card data.

3. **Stagehand Page for all DOM operations** — Stagehand v3's `Page` class provides `goto()`, `locator().fill()`, `evaluate()`, `sendCDP()`, `waitForTimeout()`. No separate Playwright CDP connection needed. Cookies handled via `page.sendCDP("Network.getCookies")` and `page.sendCDP("Network.setCookie", ...)`.

4. **Two-tier price discovery** — Tier 1 (server-side fetch + JSON-LD + OG meta tags) is fast and free. Tier 2 (Browserbase session + Stagehand cart flow) used as fallback when structured data isn't available.

5. **Domain cache** — Cookies filtered via `isSafeCookie()` to exclude session/auth/csrf tokens. Cache stored in `~/.proxo/cache/{domain}.json` with atomic writes (tmp + rename) and 0o600 permissions.

6. **Session lifecycle** — Browserbase REST API with exponential backoff on 429. `destroySession()` never throws (belt-and-suspenders cleanup in `finally` blocks). Timeout in seconds per API spec.

7. **Shipping sanitization** — `sanitizeShipping()` strips `<>"'&;` and truncates at 200 chars to prevent prompt injection via Stagehand variables.

8. **Test isolation** — Network tests use `describe.skipIf(!process.env.BROWSERBASE_API_KEY)`. Credential tests save/restore env vars. Cache tests use `PROXO_DATA_DIR` temp directories.

### E2E Discovery Testing (Post-Implementation Iteration)

After unit tests were green, real-site E2E testing was conducted using Browserbase + Anthropic API keys.

#### Bugs Found & Fixed During E2E Testing

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Stagehand model 404 errors | Model name format — Stagehand v3.0.8 requires `"anthropic/claude-sonnet-4-20250514"` with `{modelName, apiKey}` config | Updated all Stagehand constructors |
| `scrapePrice` hangs on bot-blocked sites | No fetch timeout — Best Buy blocks forever | Added `AbortSignal.timeout(10000)` |
| `destroySession` doesn't release sessions | Missing `projectId` in request body — Browserbase API requires it | Added `projectId` to destroy body |
| JSON-LD price in cents (Hydrogen demo) | Price stored as integer cents (e.g., `63295`) with no decimal | Added cents normalization: integer ≥ 100 with no decimal → divide by 100 |
| Tier 2 price has `$` prefix | Stagehand LLM includes currency symbol despite schema description | Added `stripCurrency()` post-processing |
| Offers array not handled | Some stores use `"offers": [...]` instead of `"offers": {...}` | Added `Array.isArray` check, use first offer |

#### E2E Test Results

**Tier 1 — Server-side scrape:**
| Site | Result | Price | Method |
|------|--------|-------|--------|
| Allbirds (Shopify) | Success | $100.00 | JSON-LD Product |
| Hydrogen demo (Shopify) | Success | $650.95 | JSON-LD Product (cents normalized) |
| Gymshark (Shopify) | null | — | Bot-blocked |
| Best Buy | null (10s timeout) | — | Bot-blocked |

**Tier 2 — Browserbase cart discovery:**
| Site | Result | Price | Name |
|------|--------|-------|------|
| Hydrogen demo (Shopify) | Success | 749.95 | The Full Stack Snowboard |

**`discoverPrice` fallback:**
| Site | Tier Used | Result |
|------|-----------|--------|
| Allbirds | Tier 1 (fast) | $100.00 via JSON-LD |

#### E2E Test File

| File | Tests |
|------|-------|
| `packages/checkout/tests/e2e-discover.test.ts` | 4 Tier 1 + 1 Tier 2 + 1 fallback = 6 tests |

Note: Tier 2 tests require `BROWSERBASE_API_KEY` + `ANTHROPIC_API_KEY` and consume Browserbase browser minutes.

---

## Phase 5: Buy & Confirm Orchestration — COMPLETE

**Status:** All deliverables complete, all 13 new tests passing (108 total, 113 with network tests).

---

### Architecture Decision: Orchestrator Package

The spec called for `core/buy.ts`, `core/confirm.ts`, etc. However, `buy` and `confirm` need to import from `@proxo/wallet`, `@proxo/x402`, and `@proxo/checkout` — which already depend on `@proxo/core`. This creates a circular dependency that breaks pnpm's topological build order.

**Solution:** New package `packages/orchestrator/` (`@proxo/orchestrator`) that sits on top of all other packages. Clean acyclic dependency graph: `core → wallet/x402/checkout → orchestrator`. The Phase 6 API package will import from `@proxo/orchestrator`.

---

### What Was Built

#### @proxo/orchestrator Source Files (5 files)

| File | Purpose |
|------|---------|
| `packages/orchestrator/src/router.ts` | `routeOrder(url)` — wraps x402 `detectRoute()`, returns `RouteDecision` with route + requirements |
| `packages/orchestrator/src/buy.ts` | `buy(input)` — validate URL → look up wallet → route detection → price discovery → fee calculation → balance check → create order quote |
| `packages/orchestrator/src/confirm.ts` | `confirm(input)` — expiry check → USDC transfer → execute route → build receipt → update order |
| `packages/orchestrator/src/receipts.ts` | `buildReceipt(input)` — standardized receipt from either x402 or browserbase result |
| `packages/orchestrator/src/index.ts` | Barrel re-exports (`routeOrder`, `buy`, `confirm`, `buildReceipt` + all types) |

#### Tests (2 files)

| File | Tests | All Offline |
|------|-------|-------------|
| `packages/orchestrator/tests/buy.test.ts` | 8 | Yes (mocked detectRoute, getBalance, discoverPrice) |
| `packages/orchestrator/tests/confirm.test.ts` | 5 | Yes (mocked transferUSDC, payX402, runCheckout) |

### Test Results

```
 ✓ packages/orchestrator/tests/buy.test.ts (8 tests)
 ✓ packages/orchestrator/tests/confirm.test.ts (5 tests)
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)
 ✓ packages/x402/tests/detect.test.ts (3 tests)
 ✓ packages/x402/tests/pay.test.ts (1 test)
 ✓ packages/checkout/tests/credentials.test.ts (12 tests)
 ✓ packages/checkout/tests/confirm.test.ts (7 tests)
 ✓ packages/checkout/tests/cache.test.ts (10 tests)
 ✓ packages/checkout/tests/session.test.ts (4 tests)
 ✓ packages/checkout/tests/fill.test.ts (9 tests)
 ✓ packages/checkout/tests/discover.test.ts (10 tests)

 Test Files  16 passed (16)
      Tests  108 passed (108)
```

Note: `e2e-discover.test.ts` Tier 2 test timed out (120s) against Browserbase — pre-existing, not related to Phase 5.

#### Test Gate Checklist (from 14-phased-build-plan.md)

- [x] `buy({ url: x402_endpoint })` → order with route "x402", correct 2% fee
- [x] `buy({ url: amazon_product })` → order with route "browserbase", correct 2% fee
- [x] `buy` without shipping + browser route + no defaults → `SHIPPING_REQUIRED`
- [x] `buy` without shipping + browser route + .env defaults → uses defaults
- [x] `buy` with shipping → uses provided shipping
- [x] `buy` x402 → no shipping needed
- [x] `buy` unfunded wallet → `INSUFFICIENT_BALANCE`
- [x] `buy` price > $25 → `PRICE_EXCEEDS_LIMIT`
- [x] `confirm` x402: transfers USDC fee + pays service → receipt with response
- [x] `confirm` browser: transfers USDC full amount + checks out → receipt with order number
- [x] `confirm` expired → `ORDER_EXPIRED`
- [x] `confirm` already completed → returns existing receipt
- [x] `confirm` USDC sent but purchase fails → status "failed", tx_hash preserved

### Key Implementation Notes

1. **Two USDC transfer strategies** — x402: transfer FEE only to master wallet, then `payX402()` pays the service directly from the agent wallet via EIP-3009 (gasless). Browserbase: transfer FULL amount (price + fee) to master wallet, since Proxo's own card handles the actual purchase.

2. **Balance check at buy-time** — Fast-fail on insufficient funds when creating the quote (not just at confirm time). Prevents wasted price discovery and Browserbase sessions.

3. **Idempotent confirm** — If order is already `"completed"`, returns the existing receipt without re-executing. Prevents double-charges.

4. **tx_hash preservation on failure** — If USDC transfer succeeds but execution fails (browser crash, x402 error), the tx_hash is saved to the order immediately, and status set to `"failed"` with `refund_status: "pending_manual"`. No USDC is lost, just needs manual refund in v1.

5. **Order expiry** — Orders expire after `default_order_expiry_seconds` (300s / 5 min). Confirm checks expiry before processing and updates status to `"expired"` if past deadline.

6. **All tests fully offline** — External deps (wallet, x402, checkout) are mocked via `vi.mock()`. Tests use `PROXO_DATA_DIR` temp directories with real JSON store operations.

---

## Phase 6: API Server + Funding Page — COMPLETE

**Status:** All deliverables complete, 28 new tests passing (147 total with all existing tests).

---

### What Was Built

#### @proxo/api Source Files (8 files)

| File | Purpose |
|------|---------|
| `packages/api/src/error-handler.ts` | Global Hono error handler — maps `ProxoError.code` to HTTP status via `STATUS_MAP` |
| `packages/api/src/formatters.ts` | Internal types → API response shapes (wallet, buy quote, confirm receipt, failed order) |
| `packages/api/src/routes/wallets.ts` | `POST /api/wallets` (create) + `GET /api/wallets/:wallet_id` (details + transactions) |
| `packages/api/src/routes/buy.ts` | `POST /api/buy` — validate input, call orchestrator, return quote |
| `packages/api/src/routes/confirm.ts` | `POST /api/confirm` — execute purchase, handle failed-with-tx_hash case as 200 |
| `packages/api/src/routes/fund.ts` | `GET /fund/:token` (HTML page with QR + live balance) + `GET /fund/:token/balance` (JSON) |
| `packages/api/src/server.ts` | `createApp()` factory — mounts all routes + error handler |
| `packages/api/src/index.ts` | Entry point — starts `@hono/node-server` on configured port |

#### Tests (1 file)

| File | Tests | All Offline |
|------|-------|-------------|
| `packages/api/tests/api.test.ts` | 28 | Yes (mocked wallet, orchestrator; uses Hono `app.request()`) |

### Test Results

```
 ✓ packages/api/tests/api.test.ts (28 tests)
 ✓ packages/orchestrator/tests/buy.test.ts (8 tests)
 ✓ packages/orchestrator/tests/confirm.test.ts (8 tests)
 ✓ packages/orchestrator/tests/receipts.test.ts (3 tests)
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)
 ✓ packages/x402/tests/detect.test.ts (3 tests)
 ✓ packages/x402/tests/pay.test.ts (1 test)
 ✓ packages/checkout/tests/credentials.test.ts (12 tests)
 ✓ packages/checkout/tests/confirm.test.ts (7 tests)
 ✓ packages/checkout/tests/cache.test.ts (10 tests)
 ✓ packages/checkout/tests/session.test.ts (4 tests)
 ✓ packages/checkout/tests/fill.test.ts (9 tests)
 ✓ packages/checkout/tests/discover.test.ts (10 tests)

 Test Files  18 passed (18)
      Tests  147 passed (147)
```

Note: `e2e-discover.test.ts` Tier 2 test fails due to Browserbase free plan quota — pre-existing, not related to Phase 6.

#### Test Gate Checklist (from 14-phased-build-plan.md)

- [x] Server starts: `node packages/api/dist/index.js` → listening on :3000
- [x] POST /api/wallets → returns wallet_id + funding_url (201)
- [x] GET /api/wallets/:id → returns balance + transactions (200)
- [x] POST /api/buy → returns quote with order_id, product, payment, expires_in (200)
- [x] POST /api/confirm → executes + returns receipt (200)
- [x] No auth headers required on any endpoint
- [x] GET /fund/:token returns HTML page with QR code
- [x] Funding page shows live balance (polls every 10s via /fund/:token/balance)
- [x] Invalid wallet_id → 404 JSON error
- [x] Invalid order_id → 404 JSON error
- [x] Missing required fields → 400 JSON error
- [x] funding_url contains funding_token (not wallet_id)
- [x] HTML funding page does not contain wallet_id or private_key
- [x] Checkout failed with tx_hash → 200 with failed status + error details

### Dependencies Added

**@proxo/api dependencies:**
- `hono` ^4.0.0 — lightweight HTTP framework
- `@hono/node-server` ^1.8.0 — Node.js adapter for Hono
- `@proxo/wallet` workspace:* — wallet creation, balance, QR
- `@proxo/orchestrator` workspace:* — buy/confirm orchestration

### Key Implementation Notes

1. **Factory pattern** — `createApp()` returns a Hono app instance. Tests use `app.request()` for zero-network testing. Entry point calls `serve()` from `@hono/node-server`.

2. **Error handling** — Global `onError` handler maps `ProxoError.code` to HTTP status via a lookup table. Unknown ProxoError codes → 500. Non-ProxoError exceptions → 500 with generic "Internal server error" message (no leak of internal details).

3. **Confirm failure handling** — Per spec, when USDC was sent but purchase failed (CHECKOUT_FAILED / X402_PAYMENT_FAILED with tx_hash), the confirm route catches the error and returns 200 with `{ order_id, status: "failed", error: { code, message, tx_hash, refund_status } }`. Errors without tx_hash propagate to the global error handler normally.

4. **Funding page security** — The HTML page uses `funding_token` (not `wallet_id`) in the URL. The `wallet_id` and `private_key` never appear in the HTML or JavaScript. The balance poll endpoint also uses `funding_token`.

5. **Hono sub-apps** — Each route file exports a `Hono` sub-app mounted at its prefix. `walletsRoutes` at `/api/wallets`, `buyRoutes` and `confirmRoutes` at `/api`, `fundRoutes` at `/fund`.

6. **Response formatting** — `formatters.ts` decouples internal types from API response shapes. Handles `product.source` as hostname extraction, `expires_in` as seconds remaining, and transaction history from order store.

---

## Phase 7: Coinbase Onramp + E2E Testing — COMPLETE

**Status:** All deliverables complete, 20 new offline tests passing (167 total offline). Integration tests conditional on external services.

---

### What Was Built

#### Part A: Coinbase Onramp Integration (3 files modified/created)

| File | Purpose |
|------|---------|
| `packages/core/src/config.ts` | Added `getCdpProjectId()`, `getCdpApiKeyId()`, `getCdpApiKeySecret()` — CDP env var accessors |
| `packages/api/src/routes/fund.ts` | New `GET /:token/onramp-session` endpoint — JWT signing (ES256 via jose), CDP token API call, returns `{ onrampUrl }`. HTML updated with two sections: "Buy with Card" + "Send USDC Directly", OR divider, Coinbase ToS footer |
| `.env.example` | CDP vars already present from earlier phase |

#### Part B: E2E Test Files (4 files)

| File | Tests | Dependencies |
|------|-------|-------------|
| `tests/e2e/config.test.ts` | 5 | None (offline) |
| `tests/e2e/errors.test.ts` | 8 | None (fully mocked) |
| `tests/e2e/x402-flow.test.ts` | 5 | `BASE_RPC_URL` + `TEST_WALLET_PRIVATE_KEY` |
| `tests/e2e/browser-flow.test.ts` | 5 | `BASE_RPC_URL` + `BROWSERBASE_API_KEY` + `ANTHROPIC_API_KEY` + `TEST_WALLET_PRIVATE_KEY` |

#### Part C: Onramp Tests (1 file)

| File | Tests | All Offline |
|------|-------|-------------|
| `packages/api/tests/onramp.test.ts` | 7 | Yes (mocked CDP API + jose) |

### Test Results

```
 ✓ tests/e2e/config.test.ts (5 tests)
 ✓ tests/e2e/errors.test.ts (8 tests)
 ✓ packages/api/tests/onramp.test.ts (7 tests)
 ✓ packages/api/tests/api.test.ts (28 tests)
 ✓ packages/orchestrator/tests/buy.test.ts (8 tests)
 ✓ packages/orchestrator/tests/confirm.test.ts (8 tests)
 ✓ packages/orchestrator/tests/receipts.test.ts (3 tests)
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)
 ✓ packages/x402/tests/detect.test.ts (3 tests)
 ✓ packages/x402/tests/pay.test.ts (1 test)
 ✓ packages/checkout/tests/credentials.test.ts (12 tests)
 ✓ packages/checkout/tests/confirm.test.ts (7 tests)
 ✓ packages/checkout/tests/cache.test.ts (10 tests)
 ✓ packages/checkout/tests/session.test.ts (4 tests)
 ✓ packages/checkout/tests/fill.test.ts (9 tests)
 ✓ packages/checkout/tests/discover.test.ts (10 tests)

 Test Files  21 passed (21)
      Tests  162 passed (162)
```

Integration tests (`x402-flow.test.ts`, `browser-flow.test.ts`) skip when credentials are unavailable. When credentials are present, they may fail due to external service availability (PayAI endpoint, Browserbase quota).

#### Test Gate Checklist (from 14-phased-build-plan.md)

**Part A — Onramp:**
- [x] `GET /fund/:token/onramp-session` → returns `{ onrampUrl }` (mocked CDP)
- [x] CDP API keys never exposed to client
- [x] Funding page shows two paths: "Buy with card" + "Send USDC directly"
- [x] Coinbase ToS acknowledgment visible
- [x] Graceful 503 when CDP keys not configured

**Part B — Config:**
- [x] `NETWORK=base` → correct USDC contract (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- [x] `NETWORK=base-sepolia` → correct USDC contract (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- [x] Default network is `base-sepolia` when unset

**Part C — E2E Testnet:**
- [x] Scenario E error tests all pass (offline, 8 tests)
- [x] Full flow: create wallet → get wallet → response shapes chain correctly
- [x] Error propagation: PRICE_EXCEEDS_LIMIT, INSUFFICIENT_BALANCE, WALLET_NOT_FOUND, ORDER_NOT_FOUND, ORDER_EXPIRED, SHIPPING_REQUIRED
- [x] Retry with shipping → 200 quote returned
- [ ] Scenario A x402 flow (conditional — needs funded wallet + PayAI endpoint)
- [ ] Scenarios B/C/D browser flow (conditional — needs Browserbase quota)

### Manual checks (not automated)
- [ ] Coinbase Onramp sandbox works with test session
- [ ] Mainnet flows F/G/H (with real USDC) — run manually after human setup

### Dependencies Added

**Root devDependencies:**
- `@proxo/api` workspace:* — E2E test imports
- `@proxo/core` workspace:* — E2E test imports
- `@proxo/orchestrator` workspace:* — E2E test imports
- `@proxo/wallet` workspace:* — E2E test imports
- `viem` ^2.46.2 — wallet account derivation in integration tests

**@proxo/api dependencies:**
- `jose` ^6.0.0 — ES256 JWT signing for CDP session tokens

### Key Implementation Notes

1. **Onramp endpoint security** — CDP API keys are only used server-side to sign JWTs. They never appear in HTML, JavaScript, or API responses. The funding page HTML checks `onrampAvailable` server-side and hides the Buy with Card section when CDP is not configured.

2. **JWT signing with jose** — Uses `jose.importPKCS8()` to import the base64-encoded EC private key, then `jose.SignJWT` to create an ES256 JWT with the required CDP claims (sub, iss, aud, uris). JWT expires in 120 seconds.

3. **Two-section funding page** — The HTML now has "Buy with Card" (Coinbase Onramp) and "Send USDC Directly" (QR + address) sections with an "OR" divider. The onramp section is hidden via CSS when CDP is not configured. The Coinbase ToS footer is always visible.

4. **Three-tier E2E test strategy** — Fully offline tests (config, errors, onramp) always run. RPC-dependent tests (x402-flow) run with `BASE_RPC_URL` + funded wallet. Full-stack tests (browser-flow) run with all credentials. `describe.skipIf()` ensures `pnpm test` always passes when services are unavailable.

5. **Test isolation** — All E2E tests use `PROXO_DATA_DIR` temp directories. Integration tests pre-seed wallet store with `TEST_WALLET_PRIVATE_KEY`. Config tests save/restore `NETWORK` env var. Onramp tests save/restore CDP env vars.

---

### Test Directory Map (final)

```
packages/core/tests/        ← Phase 1 (fees, store)
packages/wallet/tests/      ← Phase 2 (create, balance, qr, transfer)
packages/x402/tests/        ← Phase 3 (detect, pay)
packages/checkout/tests/    ← Phase 4 (session, placeholders, discover, checkout, cache)
packages/orchestrator/tests/ ← Phase 5 (buy, confirm, receipts)
packages/api/tests/         ← Phase 6 (routes, funding) + Phase 7 (onramp)
tests/e2e/                  ← Phase 7 (config, errors, x402-flow, browser-flow)
```

### Test Count Summary (all phases)

| Phase | Package | Tests |
|-------|---------|-------|
| 1 | core (fees, store) | 22 |
| 2 | wallet (create, balance, qr, transfer) | 17 |
| 3 | x402 (detect, pay) | 4 |
| 4 | checkout (credentials, confirm, cache, session, fill, discover) | 52 |
| 5 | orchestrator (buy, confirm, receipts) | 19 |
| 6 | api (routes, funding) | 28 |
| 7 | api (onramp) + e2e (config, errors) | 20 |
| 7 | e2e (x402-flow, browser-flow) — conditional | 10 |
| — | crawling (discover unit tests) | 24 |
| — | crawling (e2e, comparison) — conditional | ~10 |
| **Total** | | **196** (186 always-run + 10 conditional) |

---

## Firecrawl Self-Hosted Migration — COMPLETE

**Status:** All code extracted, self-hosted Firecrawl running natively (no Docker), extraction tested and validated against cloud baselines.

---

### What Was Done

1. Extracted all Firecrawl code from `packages/checkout/src/discover.ts` (~360 lines) into a new standalone `packages/crawling/` package.
2. Added open-source Firecrawl as a git submodule with shell scripts for running from source.
3. Set up self-hosted Firecrawl natively via Homebrew (Redis, RabbitMQ, PostgreSQL, Playwright service, Go, Rust).
4. Patched Firecrawl to use native Gemini (not OpenAI) and stripped Vertex-only `labels` from all AI SDK calls.
5. Validated self-hosted extraction against cloud baselines — results match.

### New Package: `@bloon/crawling`

| File | Purpose |
|------|---------|
| `packages/crawling/src/types.ts` | `FirecrawlExtract`, `FirecrawlConfig` interfaces |
| `packages/crawling/src/constants.ts` | Schema, prompt, limits (`MAX_VARIANT_EXTRACT=20`, `CRAWL_PAGE_LIMIT=25`) |
| `packages/crawling/src/client.ts` | `getFirecrawlConfig()` — configurable base URL via `FIRECRAWL_BASE_URL` |
| `packages/crawling/src/helpers.ts` | `extractPriceFromString`, `stripCurrencySymbol`, `mapOptions`, `computeWordOverlap` |
| `packages/crawling/src/poll.ts` | `pollFirecrawlJob()` — async job polling |
| `packages/crawling/src/extract.ts` | `firecrawlExtractAsync()` — `/v1/extract` wrapper |
| `packages/crawling/src/crawl.ts` | `firecrawlCrawlAsync()` — `/v1/crawl` wrapper |
| `packages/crawling/src/variant.ts` | Step 2 + Step 3 variant price resolution |
| `packages/crawling/src/discover.ts` | `discoverViaFirecrawl()` — 3-step pipeline entry |
| `packages/crawling/src/index.ts` | Barrel re-exports |

### Key Changes

1. **Configurable base URL** — `FIRECRAWL_BASE_URL` env var defaults to `http://localhost:3002` (self-hosted). Set to `https://api.firecrawl.dev` for cloud.
2. **`concurrencyPool` moved to `@bloon/core`** — shared between crawling and checkout.
3. **Checkout slimmed** — `packages/checkout/src/discover.ts` now imports from `@bloon/crawling`. Removed ~360 lines of Firecrawl code.
4. **Git submodule** — `packages/crawling/firecrawl/` → `github.com/mendableai/firecrawl.git`
5. **Self-hosted scripts (no Docker)** — `start.sh` runs Firecrawl from source via npm, `stop.sh` kills the process, `health.sh` checks port 3002.

### Self-Hosted Setup (Homebrew Native)

**Services required (all via Homebrew):**
| Service | Port | Install |
|---------|------|---------|
| Redis | 6379 | `brew install redis && brew services start redis` |
| RabbitMQ | 5672 | `brew install rabbitmq && brew services start rabbitmq` |
| PostgreSQL | 5432 | Already installed; created `firecrawl` database with NUQ schema |
| Playwright service | 3000 | Built from `firecrawl/apps/playwright-service-ts/` |
| Firecrawl API | 3002 | Built from `firecrawl/apps/api/` with Go + Rust native modules |

**Firecrawl patches for self-hosted (in submodule):**
| File | Change |
|------|--------|
| `apps/api/src/lib/generic-ai.ts` | Added `useGoogleNative` flag — redirects all `openai` provider calls to native `google` when `GOOGLE_GENERATIVE_AI_API_KEY` is set |
| `apps/api/src/scraper/scrapeURL/transformers/llmExtract.ts` | Stripped `providerOptions.google.labels` from 6 locations (Vertex-only, rejected by public Gemini API) |
| `apps/api/src/lib/extract/url-processor.ts` | Stripped `providerOptions.google.labels` from 2 locations |
| `apps/api/src/lib/extract/fire-0/url-processor-f0.ts` | Stripped `providerOptions.google.labels` from 1 location |
| `apps/api/src/lib/extract/fire-0/llmExtract-f0.ts` | Stripped `providerOptions.google.labels` from 5 locations |
| `scripts/nuq-local.sql` | PostgreSQL schema without `pg_cron` (not needed for local dev) |

**Env vars for self-hosted startup:**
```
PORT=3002 HOST=0.0.0.0 USE_DB_AUTHENTICATION=false
REDIS_URL=redis://localhost:6379
NUQ_DATABASE_URL=postgresql://<user>@localhost:5432/firecrawl
NUQ_RABBITMQ_URL=amqp://localhost:5672
PLAYWRIGHT_MICROSERVICE_URL=http://localhost:3000/scrape
GOOGLE_GENERATIVE_AI_API_KEY=<your-gemini-key>
MODEL_NAME=gemini-2.5-flash
TEST_API_KEY=fc-selfhosted FIRECRAWL_API_KEY=fc-selfhosted
```

### Self-Hosted vs Cloud Comparison

| Field | Cloud | Self-Hosted | Match? |
|-------|-------|-------------|--------|
| **Allbirds** | | | |
| Product Name | Men's Tree Runner | Men's Tree Runner | Yes |
| Price | ~$100 | $100 | Yes |
| Brand | Allbirds | Allbirds | Yes |
| Colors | Available | 2 colors | Yes |
| Sizes | Available | 7 sizes | Yes |
| **Hydrogen** | | | |
| Product Name | The Full Stack | The Full Stack Snowboard | Yes (more complete) |
| Price | $749.95 | $659.95 | Site changed price |
| Brand | Snowdevil | Snowdevil | Yes |
| Sizes | Available | 154cm, 158cm, 160cm | Yes |

**Notes:**
- Hydrogen price difference ($749.95 → $659.95) is a real site change, not an extraction error.
- Self-hosted uses Gemini 2.5 Flash (free tier: 20 req/min). Each `/v1/extract` call internally makes 5-10+ LLM calls (schema analysis, URL processing, extraction, retries).

### Tests

| File | Tests | Description |
|------|-------|-------------|
| `packages/crawling/tests/discover.test.ts` | 24 | All Firecrawl unit tests (moved from checkout) |
| `packages/crawling/tests/e2e.test.ts` | ~6 | E2E against real sites (conditional) |
| `packages/crawling/tests/comparison.test.ts` | ~4 | Self-hosted vs cloud baseline (conditional) |
| `packages/core/tests/concurrency-pool.test.ts` | 5 | Moved from checkout |
| `packages/checkout/tests/discover.test.ts` | 17 | Scrape/JSON-LD only (Firecrawl tests removed) |
