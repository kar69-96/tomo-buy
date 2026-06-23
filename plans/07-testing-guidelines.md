# Testing Guidelines — Bloon v1

## Testing Philosophy

- Test on real websites, not mocks
- Each phase has a test gate — don't proceed until all pass
- Use curl for all API testing
- Browser checkout tests use real Browserbase sessions

---

## Test Directory Structure

Tests live in a `tests/` folder within each package, **not** in `src/`. End-to-end tests live at the repo root.

```
packages/core/tests/           ← Phase 1 (fees, store, concurrency pool)
packages/checkout/tests/       ← Phase 4 (session, credentials, discover, fill, cache, confirm)
packages/crawling/tests/       ← Product discovery (Firecrawl, Exa, Browserbase, variants)
packages/orchestrator/tests/   ← Phase 5 (buy, confirm, router, query)
packages/api/tests/            ← Phase 6 (routes, server)
tests/e2e/                     ← Full flow scenarios
```

Vitest discovers all tests via:
- `packages/*/tests/**/*.test.ts`
- `tests/**/*.test.ts`

Test files import source via `../src/` relative paths (e.g., `import { calculateFee } from "../src/fees.js"`).

---

## Test Websites (Browser Checkout)

| Priority | Site | Why |
|----------|------|-----|
| 1 | Shopify store | Simplest checkout flow, consistent structure |
| 2 | Target.com | Major retailer, standard e-commerce |
| 3 | Best Buy | Electronics, good variety |
| 4 | Amazon.com | Complex checkout, stretch goal |
| 5 | Walmart.com | Complex checkout, stretch goal |

Start with Shopify, prove the flow works, then expand.

---

## Test Categories

### 1. Unit Tests (per package)

**Core (fees, validation):**
- `calculateFee("17.99")` === `"0.36"`
- `calculateTotal("17.99")` === `"18.35"`
- Price > $25 throws `PRICE_EXCEEDS_LIMIT`

**Store (JSON persistence):**
- Create wallet → read → matches
- Create order → update status → read → correct
- Data persists to disk, survives reload

### 2. Integration Tests (cross-package)

**Browser Checkout:**
- `createBrowserbaseSession()` returns session with CDP URL
- `destroySession(id)` succeeds
- `buildPlaceholders()` has all `x_*` keys matching .env
- Task template contains `x_card_number`, NOT real number
- LLM conversation log has zero real credential values

**Price Discovery:**
- `discover(target_url)` returns `{ name, price }`
- `discover(shopify_url)` returns `{ name, price }`
- `discover(bad_url)` returns `PRICE_EXTRACTION_FAILED`

### 3. API Tests (curl)

```bash
# Discover product
curl -s -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"url":"https://allbirds.com/products/mens-tree-runners"}' | jq .

# Get quote
curl -s -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{"url":"https://...","shipping":{"name":"Test","street":"123 Main St","city":"Austin","state":"TX","zip":"78701","country":"US","email":"test@example.com","phone":"5551234567"}}' | jq .

# Confirm purchase
curl -s -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{"order_id":"ORDER_ID"}' | jq .
```

### 4. Error Path Tests

| Test | Expected |
|------|----------|
| Buy product > $25 | `PRICE_EXCEEDS_LIMIT` (400) |
| Buy physical item, no shipping | `SHIPPING_REQUIRED` (400) |
| Confirm expired order | `ORDER_EXPIRED` (410) |
| Confirm nonexistent order | `ORDER_NOT_FOUND` (404) |
| Buy with unreachable URL | `URL_UNREACHABLE` (400) |

### 5. End-to-End Tests

**Scenario A: Browser Purchase (Shopify → Target)**
1. `POST /api/query` with product URL → product info + required fields
2. `POST /api/buy` with product URL + shipping → quote with 2% fee
3. `POST /api/confirm` → browser checkout, receipt with order number

**Scenario B: Domain Cache**
1. Buy from Target (first time) → cache created at `~/.bloon/cache/target.com.json`
2. Buy from Target (second time) → cache injected, checkout completes

---

## Credential Security Verification

After every browser checkout test, verify:
- [ ] LLM conversation log contains zero real card numbers
- [ ] LLM log contains only `x_card_number`, `x_card_cvv`, etc.
- [ ] Real values only appear in DOM injection (Browserbase session)
- [ ] No credentials in API response bodies
- [ ] No card credentials in `~/.bloon/orders.json`

---

## Phase Test Gate Summary

| Phase | Test Directory | Test Files | Key Tests |
|-------|---------------|------------|-----------|
| 1 | `packages/core/tests/` | `fees.test.ts`, `store.test.ts`, `concurrency-pool.test.ts` | Types compile, store CRUD, fee math, async pool |
| 4a | `packages/checkout/tests/` | `session.test.ts`, `credentials.test.ts`, `discover.test.ts`, `fill.test.ts`, `cache.test.ts`, `confirm.test.ts` | Session, credentials, discovery, fill, cache |
| 4b | `packages/crawling/tests/` | Firecrawl, Exa, Browserbase, variant tests | Discovery pipeline, variant resolution |
| 5 | `packages/orchestrator/tests/` | `buy.test.ts`, `confirm.test.ts`, `query.test.ts` | Buy + confirm + query orchestration |
| 6 | `packages/api/tests/` | Route tests, server tests | Server starts, all endpoints work, funding page |
| 7 | `tests/e2e/` | End-to-end scenario tests | Full flow scenarios |

See `14-phased-build-plan.md` for detailed test gates per phase.
