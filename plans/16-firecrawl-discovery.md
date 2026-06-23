# Firecrawl Product Discovery Pipeline

Firecrawl is the **primary** product discovery tier. It runs before server-side scraping and Browserbase. The goal: extract product info, variant options, and per-variant pricing without launching a browser session.

## Environment

```
FIRECRAWL_API_KEY=fc-...
FIRECRAWL_BASE_URL=http://localhost:3002   # default: self-hosted
# or: FIRECRAWL_BASE_URL=https://api.firecrawl.dev  # cloud
```

`FIRECRAWL_API_KEY` is required. If not set, Firecrawl tier is skipped entirely and discovery falls through to server-side scrape → Browserbase.

`FIRECRAWL_BASE_URL` defaults to `http://localhost:3002` (self-hosted). Set to `https://api.firecrawl.dev` for cloud.

## Pipeline Overview

```
/scrape on product URL (up to 3 attempts with exponential backoff)
    │
    ├── Confidence >= 0.75 + valid price → accept candidate
    │     │
    │     ├── No options detected → done (simple product)
    │     ├── Options + variant URLs → /scrape on each variant URL → done
    │     └── Options + NO variant URLs → /crawl (maxDepth: 1) → done
    │
    ├── Confidence < 0.75 or missing fields → Browserbase+Gemini repair path
    │     │
    │     └── Re-rank all candidates → best wins → continue to variant resolution
    │
    └── All attempts fail → return null (falls through to scrape → Browserbase tiers)
```

Every product query starts with Step 1 (up to 3 attempts). If the best candidate doesn't meet the confidence threshold, the Browserbase+Gemini fallback runs before Steps 2/3.

## Step 1: `/scrape` on Product URL (up to 3 attempts)

**Always runs.** Extracts structured product data from the rendered page via Firecrawl's `/v1/scrape`.

**Endpoint:** `POST {FIRECRAWL_BASE_URL}/v1/scrape`

**Why `/scrape` instead of `/extract`:** The `/v1/extract` endpoint triggers a heavy internal pipeline (schema analysis, multi-entity detection, URL mapping/reranking, SmartScrape, JSON repair) totaling 3-10+ LLM calls per request. Since we always provide an exact URL and a fixed schema, `/v1/scrape` with `formats: ["json"]` + `jsonOptions` does the same single-page extraction with **1 LLM call**, eliminating all unnecessary overhead. This improves rate limit headroom from ~2-3 to ~20 extractions/min on Gemini free tier.

### Retry Strategy

Step 1 runs up to **3 attempts** with exponential backoff:

```
Attempt 0: immediate
Attempt 1: wait 2s, retry
Attempt 2: wait 4s, retry
```

Each attempt produces a **candidate** that gets scored by the parser ensemble (see below). The loop breaks early if:
- Best candidate's confidence >= `QUERY_MIN_CONFIDENCE` (default: 0.75) AND price is valid
- Price is explicitly invalid (additional retries won't help)

### Content Classification

Before extraction, the raw markdown is checked for failure signals:

- **BLOCKED_PATTERNS** (24 patterns in `constants.ts`): Cloudflare challenges, CAPTCHAs, Akamai/PerimeterX/DataDome, Incapsula, DistilNetworks, generic bot detection phrases
- **NOT_FOUND_PATTERNS** (24 patterns in `constants.ts`): "product not found", "discontinued", "no longer available", 404 indicators

If blocked patterns are detected, `failure_code: "blocked"` is recorded. If not-found patterns match, a `ProductNotFoundError` is thrown.

### Parser Ensemble (Candidate Ranking)

All candidates from Firecrawl attempts (and the optional Browserbase repair) are scored by `chooseBestCandidate()` in `parser-ensemble.ts`. Scoring weights:

| Signal | Weight | Notes |
|--------|--------|-------|
| Name present | +0.35 | |
| Valid price | +0.45 | Must match numeric pattern |
| Weak/unparseable price | +0.10 | Has price text but not valid format |
| Options signal | +0.10 | Scaled by ratio of populated option groups |
| Variant URLs | +0.05 | |
| Description | +0.03 | |
| Image URL | +0.01 | |
| Currency | +0.01 | |
| Browserbase source | +0.02 | Slight bias toward browser-rendered data |

Maximum possible score: 1.0. Minimum to proceed: must have a valid price.

### Browserbase+Gemini Repair Path

If after all Firecrawl attempts:
- No valid candidate exists (missing name or price), OR
- Best candidate has confidence < 0.75 but does have a valid price

...then the Browserbase+Gemini fallback runs:

1. **Fetch rendered HTML** from the Browserbase adapter (`POST localhost:3003/scrape`)
   - Adapter waits up to **12s** for content readiness (was 5s) via `Promise.race` between `networkidle` and product selector detection
   - **21 product selectors** including itemprop, data-product, class-based patterns, `aria-label*="price"`, `data-automation-id*="price"`, `data-feature-name*="price"`, `.product-price`, `.offer-price`, `[class*="buybox"]`
2. **Try structured extraction first** (fast, no LLM cost): JSON-LD → meta tags → CSS selectors
   - **11 CSS price selectors** (expanded from 5): `[data-price]`, `[data-testid*="price"]`, `[aria-label*="price"]`, `[data-automation-id*="price"]`, `.price`, `#price`, `[class*="productPrice"]`, `[class*="buybox"] [class*="price"]`, `[class*="offer"] [class*="price"]`, `span[class*="amount"]`, generic `[class*="price"]` with exclusions
3. **Fall back to Gemini markdown extraction**: Convert HTML to markdown via `htmlToMarkdown()` — tries main-content selectors first, strips boilerplate, caps at 30k chars
4. **Gemini prompt** includes guidance for subscription vs one-time pricing (extract one-time price as main) and sale vs original pricing (extract selling price as price, compare-at as original_price)
5. **Add result as a candidate** — re-rank all candidates, best wins

### Shopify Fallback for Options

If the winning candidate has no options, the pipeline tries `fetchShopifyOptions(url)` — hits the Shopify `.json` product endpoint. If it's a Shopify store with variant data, options are populated from the API response.

### What it extracts

| Field | Description |
|-------|-------------|
| `name` | Product name / title |
| `price` | Current selling price |
| `original_price` | Price before discount (if on sale) |
| `currency` | Currency code (USD, EUR, etc.) |
| `brand` | Brand or manufacturer |
| `image_url` | Main product image |
| `description` | Short product description |
| `options` | Array of option groups, each with `name`, `values[]`, and optional `prices{}` |
| `variant_urls` | URLs linking to other variants of the same product |

**Decision after Step 1:**

- If `options` is empty → product has no variants. Return result. Done.
- If `options` has entries AND `variant_urls` is non-empty → go to Step 2.
- If `options` has entries AND `variant_urls` is empty → go to Step 3.

## Step 2: `/scrape` on Each Variant URL

**Runs when:** Step 1 found option groups (Color, Size, etc.) **and** variant URLs.

For each variant URL, make a separate `/scrape` call with the same product schema + JSON format. Each call returns the product name, price, and selected options for that specific variant.

**Caps:**
- Max 20 variant URLs per product (to control credit spend)
- Calls run in parallel

**Result:** Build a per-option price map by comparing prices across variant pages. For example, if the Red variant page shows $29.99 and the Blue variant page shows $34.99, the Color option gets `prices: { "Red": "29.99", "Blue": "34.99" }`.

**Same-price filter:** If all resolved prices are identical, omit the `prices` map (variants don't affect price).

## Step 3: `/crawl` from Product URL

**Runs when:** Step 1 found option groups **but no variant URLs**. This means the page has selectors/swatches for variants but the LLM couldn't find distinct URLs for each variant.

**Endpoint:** `POST https://api.firecrawl.dev/v1/crawl`

**Configuration:**
- `maxDepth: 1` — only follow links one level deep from the product page
- Same domain only
- Extraction schema applied to every discovered page
- Limit: 25 pages max

**Result:** Filter crawled pages for ones that look like variants of the original product:
- Same or very similar product name
- Different price or different option selections
- URL structurally similar to the original (same path prefix, different slug or query param)

Build per-variant price map from matching pages, same as Step 2.

## Credit Cost

| Step | Credits | When |
|------|---------|------|
| Step 1 (product extract) | ~1 | Always |
| Step 2 (variant extracts) | ~1 per variant URL | Only when variant URLs found |
| Step 3 (crawl) | ~1 per crawled page | Only when options exist but no variant URLs |

Worst case for a product with 20 variant URLs: ~21 credits. Typical Shopify product with 5 colors: ~6 credits. Simple product with no variants: ~1 credit.

## Firecrawl Extraction Schema

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Product name or title" },
    "price": { "type": "string", "description": "Current selling price" },
    "original_price": { "type": "string", "description": "Original price before discount, if on sale" },
    "currency": { "type": "string", "description": "Currency code, e.g. USD, EUR" },
    "brand": { "type": "string", "description": "Brand or manufacturer" },
    "image_url": { "type": "string", "description": "Main product image URL" },
    "description": { "type": "string", "description": "Short product description" },
    "options": {
      "type": "array",
      "description": "ALL product variant option groups (Color, Size, Style, Material, Width, etc.)",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Option group name" },
          "values": { "type": "array", "items": { "type": "string" }, "description": "All available values" },
          "prices": {
            "type": "object",
            "description": "Map of value→price if different values have different prices",
            "additionalProperties": { "type": "string" }
          }
        }
      }
    },
    "variant_urls": {
      "type": "array",
      "description": "URLs for other variants of this same product (from color swatches, style links, etc.)",
      "items": { "type": "string" }
    }
  }
}
```

The same schema is used for Step 1, Step 2, and the extraction within Step 3's crawl.

## Failure Priority Tracking

The pipeline tracks the **highest-priority failure** across all attempts. When multiple failures occur, the most actionable one is surfaced:

| Failure Code | Priority | Meaning |
|--------------|----------|---------|
| `llm_config` | 100 | Missing FIRECRAWL_API_KEY |
| `blocked` | 90 | Anti-bot/CAPTCHA detected |
| `not_found` | 85 | Product page is 404/discontinued |
| `adapter_502` | 70 | Browserbase adapter returned 502 |
| `render_timeout` | 65 | Page render timed out |
| `http_error` | 60 | Non-2xx HTTP response |
| `extract_empty` | 40 | Extraction returned no usable data |
| `transport_error` | 30 | Network/fetch failure |

Higher-priority failures overwrite lower-priority ones in the diagnostics.

## Where Firecrawl Fails (→ Browserbase)

Firecrawl cannot handle:
- **Anti-bot sites** — pages that require JavaScript interaction, CAPTCHAs, or bot detection bypass (Amazon, Best Buy)
- **Single-URL variant sites** — pages where all variants live on one URL behind JavaScript interactions (no separate URLs to crawl)
- **Login-gated pricing** — sites that require authentication to show prices

These fall through to Browserbase Tier 3 (headless Chrome + Stagehand agent).

## BLOCKED_DOMAINS (url-classifier.ts)

Domains confirmed to block both Firecrawl and Exa (403/429/WAF). Requests are routed directly to Browserbase (`blocked_only` strategy), skipping wasted Exa + Firecrawl attempts:

chewy.com, barnesandnoble.com, etsy.com, amazon.* (11 TLDs), bestbuy.com, target.com, walmart.com, costco.com, levi.com

Note: The Browserbase+Gemini repair path within the Firecrawl pipeline (Step 1b) catches some anti-bot cases. The full Tier 3 Browserbase+Stagehand path in `packages/checkout` is more capable but slower — it uses an LLM agent to interact with the page rather than just rendering and extracting.

## Full Discovery Pipeline (All Tiers)

```
1. Firecrawl /scrape (primary — rich data + variant pricing, 1 LLM call)
      ↓ if Firecrawl fails or FIRECRAWL_API_KEY not set
2. Server-side scrape (free — JSON-LD + meta tags)
      ↓ if scrape fails (bot-blocked, no structured data)
3. Browserbase + Stagehand (last resort — headless Chrome + LLM)
      ↓ if all fail
   BloonError: QUERY_FAILED
```

## Self-Hosted Firecrawl

The `@bloon/crawling` package includes the open-source Firecrawl as a git submodule. Self-hosting eliminates cloud credit limits — extraction quality comes from whatever LLM you configure (we reuse the existing `GOOGLE_API_KEY` for Gemini).

**Setup:**
```bash
# Initialize the submodule (one-time)
cd packages/crawling && git submodule update --init

# Start self-hosted Firecrawl (runs on port 3002)
pnpm firecrawl:start

# Check health
pnpm firecrawl:health

# Stop
pnpm firecrawl:stop
```

**How it works:** The start script installs deps in `packages/crawling/firecrawl/apps/api` and runs the Firecrawl API server directly via Node. It configures the LLM via OpenAI-compatible API pointing to Gemini (`GOOGLE_API_KEY`).

**Trade-offs vs cloud:**
- No Fire Engine (anti-bot proxies) — not useful for our use case
- No rate limits or credit caps
- Same `/v1/scrape` and `/v1/crawl` endpoints
- LLM quality depends on your configured model (Gemini 2.5 Flash by default)

## Files

| File | Role |
|------|------|
| `packages/crawling/src/discover.ts` | Discovery orchestrator: 3 Firecrawl attempts + Browserbase repair + variant resolution |
| `packages/crawling/src/extract.ts` | Firecrawl `/v1/scrape` wrapper with content classification (blocked/not-found patterns) |
| `packages/crawling/src/browserbase-extract.ts` | Browserbase+Gemini fallback: fetch HTML → markdown → Gemini extraction |
| `packages/crawling/src/browserbase-adapter.ts` | Browserbase adapter HTTP server (Firecrawl's Playwright microservice protocol) |
| `packages/crawling/src/parser-ensemble.ts` | Candidate scoring/ranking across extraction sources |
| `packages/crawling/src/providers.ts` | Pluggable provider abstraction (`QueryDiscoveryProviders` interface) |
| `packages/crawling/src/crawl.ts` | `/v1/crawl` async wrapper |
| `packages/crawling/src/variant.ts` | Step 2 + Step 3 variant price resolution |
| `packages/crawling/src/shopify.ts` | Shopify `.json` endpoint fallback for options |
| `packages/crawling/src/client.ts` | Config: `getFirecrawlConfig()` (base URL + API key) |
| `packages/crawling/src/helpers.ts` | Price utilities: `stripCurrencySymbol`, `mapOptions`, `computeWordOverlap`, `isValidPrice` |
| `packages/crawling/src/poll.ts` | Async job polling |
| `packages/crawling/src/constants.ts` | Schema, prompt, limits, BLOCKED_PATTERNS, NOT_FOUND_PATTERNS, content selectors |
| `packages/crawling/src/types.ts` | `FirecrawlExtract`, `FirecrawlConfig` |
| `packages/crawling/src/index.ts` | Public exports for `@bloon/crawling` package |
| `packages/crawling/firecrawl/` | Git submodule → github.com/mendableai/firecrawl |
| `packages/crawling/scripts/start.sh` | Start Browserbase adapter (3003) + Firecrawl API (3002) with env validation |
| `packages/crawling/scripts/stop.sh` | Stop both processes via PID files or port-based fallback |
| `packages/crawling/scripts/health.sh` | Health check |
| `packages/checkout/src/discover.ts` | Scrape + Browserbase+Stagehand discovery (imports `discoverViaFirecrawl` from `@bloon/crawling`) |
| `packages/checkout/tests/e2e-discover.test.ts` | E2E tests for scrape + browser tiers |
| `packages/crawling/tests/discover.test.ts` | Unit tests for Firecrawl pipeline |
| `packages/crawling/tests/bulk-url-test.ts` | Bulk URL discovery benchmarks |
| `packages/crawling/tests/parser-ensemble.test.ts` | Parser ensemble unit tests |
| `packages/crawling/tests/e2e.test.ts` | E2E tests against real sites via Firecrawl |
| `packages/crawling/tests/comparison.test.ts` | Self-hosted vs cloud baseline validation |
