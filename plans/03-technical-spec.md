# Technical Spec — Bloon v1

## API vs MCP — Why API-First

| | REST API (chosen) | MCP |
|---|---|---|
| **Reach** | Any agent, any language, any framework — just HTTP | Only MCP-compatible clients |
| **Discovery** | skill.md — agents find and use Bloon immediately | Must pre-install locally |
| **Hosting** | One server, many agents, works remotely | Local only |
| **Multi-tenant path** | Natural | Full rewrite |
| **Long-running checkout** | Async HTTP — natural fit | Blocks stdio pipe |
| **Testing** | curl | Need MCP client |
| **Auth** | None for v1 (single operator) | None (local) |
| **Build effort** | Slightly more (Hono routes vs tool handlers) | Less |

MCP wrapper planned for v2 — thin layer that calls the REST API.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Any AI Agent / curl / script / SDK                  │
└────────────────────┬────────────────────────────────┘
                     │ HTTP (no auth headers)
┌────────────────────▼────────────────────────────────┐
│               packages/api (Hono)                    │
│                                                      │
│  POST /api/query       POST /api/buy                 │
│  POST /api/confirm                                   │
└────┬─────────────────────────────────────────────────┘
     │
┌────▼─────────────────────────────────────────────────┐
│            packages/orchestrator                      │
│  query(), buy(), confirm()                            │
│  Receipt builder, business logic glue                 │
└────┬──────────┬──────────────────────────────────────┘
     │          │
     │   ┌──────▼──────────────────────────────────┐
     │   │          packages/checkout              │
     │   │  discoverPrice, discoverProduct         │
     │   │  runCheckout (12-step Stagehand agent)  │
     │   │  Credentials, Domain Cache, Session     │
     │   └──────┬─────────────────────────────────┘
     │          │
     │   ┌──────▼──────────────────────────────────┐
     │   │          packages/crawling               │
     │   │  discoverViaFirecrawl (primary)          │
     │   │  discoverViaExa (Stage 2.5, parallel)    │
     │   │  browserbaseExtract (repair path)        │
     │   │  Variant resolution, Parser ensemble     │
     │   └─────────────────────────────────────────┘
     │
┌────▼──────────────────────┐
│          core              │
│                            │
│  Types, Store, Fees        │
│  Config, ErrorCodes        │
│  ConcurrencyPool           │
└────────────────────────────┘
```

> **Note:** The `wallet` and `x402` packages have been removed. Bloon now uses credit card via browser checkout only. Stub re-exports may exist in `packages/stubs/` for backward compatibility.

## Monorepo Structure

```
bloon/
├── packages/
│   ├── core/src/
│   │   ├── types.ts              # All TypeScript interfaces + error codes
│   │   ├── store.ts              # JSON file persistence (~/.bloon/) with atomic writes
│   │   ├── fees.ts               # 2% flat fee (BigInt arithmetic)
│   │   ├── config.ts             # Load .env + config.json
│   │   ├── concurrency-pool.ts   # Generic async task queue (order-preserving)
│   │   └── index.ts
│   │
│   ├── orchestrator/src/
│   │   ├── query.ts        # Product discovery orchestrator
│   │   ├── buy.ts          # Buy orchestrator (quote generation)
│   │   ├── confirm.ts      # Confirm orchestrator (checkout execution)
│   │   ├── receipts.ts     # Receipt builder
│   │   └── index.ts
│   │
│   ├── crawling/src/
│   │   ├── discover.ts              # Discovery orchestrator (3 attempts + repair path)
│   │   ├── exa.ts                   # Exa.ai Stage 2.5 extraction (parallel)
│   │   ├── extract.ts               # Firecrawl /v1/scrape wrapper + content classification
│   │   ├── browserbase-adapter.ts   # HTTP server: Playwright microservice (port 3003)
│   │   ├── browserbase-extract.ts   # Browserbase+Gemini fallback extraction
│   │   ├── parser-ensemble.ts       # Multi-source candidate scoring/ranking
│   │   ├── providers.ts             # Pluggable provider abstraction
│   │   ├── crawl.ts                 # /v1/crawl async wrapper
│   │   ├── variant.ts               # Variant price resolution (Step 2 + 3)
│   │   ├── shopify.ts               # Shopify .json fallback for options
│   │   ├── client.ts                # Firecrawl config (base URL + API key)
│   │   ├── helpers.ts               # Price utilities
│   │   ├── poll.ts                  # Async job polling
│   │   ├── constants.ts             # Schema, patterns, limits, selectors
│   │   ├── types.ts                 # FirecrawlExtract, FirecrawlConfig
│   │   └── index.ts
│   │
│   ├── checkout/src/
│   │   ├── task.ts          # 12-step checkout orchestration (Stagehand agent)
│   │   ├── session.ts       # Browserbase session create/destroy + domain cache inject
│   │   ├── credentials.ts   # Credential mapping (.env → x_* keys, CDP vs Stagehand split)
│   │   ├── fill.ts          # Card field CDP fill (iframe-aware) + form field evaluation
│   │   ├── discover.ts      # Price discovery tiers (scrape → cart → browser) + variant resolution
│   │   ├── confirm.ts       # Confirmation page detection
│   │   ├── agent-tools.ts   # Stagehand agent tools (fillShippingInfo, fillCardFields, fillBillingAddress)
│   │   ├── cache.ts         # Domain page cache (cookies/localStorage per domain)
│   │   ├── cost-tracker.ts  # LLM call + session cost tracking
│   │   ├── step-tracker.ts  # 13-step checkout progress tracking
│   │   ├── concurrency-pool.ts  # Checkout-specific concurrency pool
│   │   └── index.ts
│   │
│   └── api/src/
│       ├── server.ts        # Hono app + route wiring + error handler
│       ├── formatters.ts    # Response formatters (wallet, query, buy, confirm)
│       ├── error-handler.ts # BloonError → HTTP status mapping
│       ├── routes/
│       │   ├── query.ts     # POST /api/query
│       │   ├── buy.ts       # POST /api/buy
│       │   └── confirm.ts   # POST /api/confirm
│       └── index.ts         # Entry point: start server on :3000
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Runtime | Node.js 20+ | Server |
| Language | TypeScript 5.x | Types |
| Package Manager | pnpm 9.x | Monorepo |
| HTTP Server | hono 4.x | REST API |
| Browser Automation | @browserbasehq/stagehand | LLM-powered checkout + discovery |
| Cloud Browser | Browserbase | Remote sessions (checkout + adapter) |
| LLM (Checkout) | @anthropic-ai/sdk | Sonnet 4 for Stagehand checkout |
| LLM (Discovery) | Gemini 2.5 Flash | Firecrawl extraction + Browserbase fallback |
| Product Discovery | Firecrawl (self-hosted) | Primary extraction tier via /v1/scrape |
| Product Discovery | Exa.ai (exa-js) | Stage 2.5 parallel extraction (fills gap between scrape and Browserbase) |
| HTML Processing | cheerio + turndown | HTML→Markdown for Browserbase fallback |
| Gemini SDK | @google/generative-ai | Structured extraction in Browserbase fallback |

## Key Design Decisions

### 1. No Auth — Single Operator

No API keys. No registration. No auth headers.
- All endpoints are open — single operator model
- The operator's credit card is configured in `.env`
- Proper auth (API keys, registration) planned for v2

### 2. Two-Phase Purchase (buy then confirm)

`POST /api/buy` returns a quote. `POST /api/confirm` executes. Agent can present the quote to the human before spending.

### 3. Shipping: Required Per-Purchase, No Defaults

- Provided in request → use it
- Omitted → return `SHIPPING_REQUIRED`

### 4. Stagehand with Claude Sonnet 4

From AgentPay. Browserbase's AI browser automation SDK — provides `act()`, `observe()`, `extract()` primitives. Card fields filled via separate Playwright CDP connection (never through Stagehand's LLM). Handles arbitrary websites.

### 5. Fresh Browserbase Sessions + Domain Caching

Each checkout = fresh session. But we cache cookies/localStorage per domain:
- Skips cookie banners, preserves preferences on repeat visits
- NOT login persistence — no auth tokens cached
- Cache stored at `~/.bloon/cache/{domain}.json`

### 6. Hono

Lightweight (14KB), TypeScript-native, runs on Node/Cloudflare/Vercel/Deno. Easy to deploy anywhere.

### 7. Closed Source

Not open source. Deployed and operated by you.

### 8. Price Discovery — Tiered Approach

`POST /api/buy` must return the **full price** the agent will pay (item + tax + shipping + Bloon fee). Price discovery uses a tiered approach:

**Tier 1: Firecrawl (primary, rich)**
- Uses Firecrawl `/v1/scrape` endpoint with up to 3 attempts (exponential backoff: 2s, 4s)
- Each attempt scored by parser ensemble; loop breaks early if confidence >= 0.75
- If confidence is low, Browserbase+Gemini repair path renders the page and extracts via Gemini 2.5 Flash
- Shopify `.json` fallback for options if LLM returns none
- If variant URLs found → runs `/v1/scrape` on each variant URL to resolve per-variant pricing
- If options exist but no variant URLs → runs `/v1/crawl` (maxDepth: 1) to discover variant pages
- Requires `FIRECRAWL_API_KEY` env var. If not set, skipped entirely.
- See `plans/16-firecrawl-discovery.md` for the full pipeline spec

**Tier 1.5: Exa.ai (parallel, best-effort)**
- Runs in parallel with Firecrawl — whichever succeeds first wins
- Uses Exa.ai `/contents` endpoint with structured extraction schema
- Handles bot-blocked sites that Firecrawl can't reach
- Requires `EXA_API_KEY` env var. Skipped if not set.
- See `plans/19-exa-discovery.md` for details

**Tier 2: HTML Scrape (fast, free)**
- Server-side HTTP fetch of the product URL
- Parse structured data: JSON-LD (`@type: Product`), Open Graph meta tags, `<meta property="product:price:amount">`
- Extract item price + product name + variant options from JSON-LD `hasVariant`/`offers`
- Falls through to Tier 3 if bot-blocked or no structured data found

**Tier 3: Browserbase + Stagehand (slow, accurate, last resort)**
- Launch a Browserbase session with headless Chrome
- Navigate to product URL → LLM extracts product info and variant options
- For per-variant pricing: Stagehand agent selects each variant and reports the updated price
- Used for anti-bot sites (Amazon, Best Buy) and pages without structured data
- Most expensive tier (Browserbase session + LLM API calls per variant)

The `discovery_method` field in the response tells the agent (and us) which tier was used: `"firecrawl"`, `"exa"`, `"scrape"`, or `"browserbase"`.

At confirm time, the browser route runs a **fresh** Browserbase session to do the actual checkout. If the final cart total at checkout time differs from the quoted total by more than $1 or 5% (whichever is smaller), the checkout aborts with `PRICE_MISMATCH` before payment — no funds at risk.

## Payment Flow

```
POST /api/confirm { order_id }
  │
  ├─ Load order from store
  ├─ Verify order is awaiting_confirmation and not expired
  ├─ Update status → "processing"
  │
  ├─ Fresh Browserbase session (inject domain cache)
  ├─ Stagehand: act(navigate) → act(add to cart) → act(fill) → CDP fill cards → act(submit)
  ├─ Extract confirmation number
  ├─ Update domain cache
  ├─ Return receipt with order number
  │
  └─ Save receipt, update order status → "completed"
```

## Credential Placeholder System

LLM never sees real card data:

```
Card fields (Playwright CDP fill — bypasses LLM entirely):
  card_number      →    page.fill(selector, "4111111111111111")
  card_expiry      →    page.fill(selector, "12/25")
  card_cvv         →    page.fill(selector, "123")

Non-card fields (Stagehand variables — %var% not shared with LLM):
  stagehand.act("fill name with %name%", { variables: { name: "John Doe" } })
  stagehand.act("fill address with %street%", { variables: { street: "123 Main St" } })
```

## Test Websites

| Site | Complexity |
|------|-----------|
| Shopify DTC store | Low |
| Target.com | Low-Medium |
| Best Buy | Medium |
| Amazon.com | High (stretch goal) |
| Walmart.com | Medium |
