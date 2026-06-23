# Query Endpoint — Product Discovery & NL Search

`POST /api/query` has two modes:

- **URL mode** `{ url }` — discover a specific product URL (existing behavior)
- **NL search mode** `{ query }` — describe what you want in plain English, get back 5 products

The two fields are mutually exclusive. Sending both or neither returns `400 MISSING_FIELD`.

No wallet required. No money spent. This is a read-only lookup.

## URL Mode

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.allbirds.com/products/mens-tree-runners" }'
```

## NL Search Mode

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{ "query": "towels on amazon under $15" }'
```

> **Full NL search spec:** See `plans/22-nl-search.md` for pipeline details, scoring, domain aliases, price patterns, and limitations.

## Request

| Field | Type | One-of | Description |
|-------|------|--------|-------------|
| `url` | string | yes | Product URL |
| `query` | string | yes | Natural language product query |

## URL Mode Response

```json
{
  "product": {
    "name": "Men's Tree Runners",
    "url": "https://www.allbirds.com/products/mens-tree-runners",
    "price": "98.00",
    "source": "www.allbirds.com",
    "image_url": "https://cdn.allbirds.com/...",
    "brand": "Allbirds",
    "currency": "USD"
  },
  "options": [
    {
      "name": "Color",
      "values": ["Basin Blue", "Natural White", "Bough Green"],
      "prices": { "Basin Blue": "98.00", "Natural White": "98.00", "Bough Green": "110.00" }
    },
    {
      "name": "Size",
      "values": ["8", "9", "10", "11", "12"]
    }
  ],
  "required_fields": [
    { "field": "shipping.name", "label": "Full name" },
    { "field": "shipping.email", "label": "Email address" },
    { "field": "shipping.phone", "label": "Phone number" },
    { "field": "shipping.street", "label": "Street address" },
    { "field": "shipping.apartment", "label": "Apartment / Floor / Suite" },
    { "field": "shipping.city", "label": "City" },
    { "field": "shipping.state", "label": "State / Province" },
    { "field": "shipping.zip", "label": "ZIP / Postal code" },
    { "field": "shipping.country", "label": "Country" },
    { "field": "selections", "label": "Product options (Color, Size)" }
  ],
  "discovery_method": "firecrawl"
}
```

| Field | Description |
|-------|-------------|
| `product` | Name, price, image, brand, currency. Price is the default/base price. |
| `options` | Variant groups. `prices` is a value→price map, only present when variants have different prices. |
| `required_fields` | What the agent must provide in `POST /api/buy`. Shipping fields are always included for physical products. `selections` appears only if options exist. |
| `discovery_method` | Which tier found the data: `"firecrawl"`, `"scrape"`, `"exa"`, or `"browserbase"`. |

## How It Works

> **Detailed pipeline documentation:** See `plans/endpoints/query-endpoint.md` for the full pipeline spec with scoring weights, env vars, failure codes, and code paths.

### Step 1: Product Discovery

`discoverProduct(url)` runs a 4-tier pipeline. Each tier is tried in order; the first to succeed wins.

```
Tier 1:   Firecrawl    → up to 3 attempts + Browserbase+Gemini repair, candidate ranking, variant pricing
Tier 2:   Scrape       → free server-side fetch, JSON-LD + meta tags + variant extraction
Tier 2.5: Exa.ai       → livecrawl + LLM structured extraction (~$0.002/req, 5-15s)
Tier 3:   Browserbase  → headless Chrome + Stagehand agent + per-variant interaction
```

#### Tier 1: Firecrawl (Primary)

Requires `FIRECRAWL_API_KEY`. Skipped if not set.

Uses Firecrawl's `/v1/scrape` endpoint with up to **3 attempts** (exponential backoff: 2s, 4s). Each attempt produces a candidate scored by the parser ensemble. The loop breaks early if confidence >= 0.75 with a valid price.

If confidence is too low or required fields are missing, a **Browserbase+Gemini repair path** renders the page via the Browserbase adapter and extracts product data via Gemini 2.5 Flash. All candidates are re-ranked and the best wins.

After the winning candidate is selected:
- **Shopify fallback**: If no options, tries the Shopify `.json` endpoint
- **Variant URLs found**: Runs `/v1/scrape` on each variant URL for per-variant pricing
- **Options but no variant URLs**: Runs `/v1/crawl` (maxDepth: 1) to discover variant pages

See `plans/16-firecrawl-discovery.md` for the full Firecrawl pipeline spec.

#### Tier 2: Server-Side Scrape (Free Fallback)

Plain HTTP fetch of the product URL. Parses:
- JSON-LD (`@type: Product`) — name, price, variant options from `hasVariant`/`offers`/`additionalProperty`
- Open Graph meta tags — `og:title`, `product:price:amount`

Fast (~1-2s), free, no API key needed. Works well on Shopify, most DTC stores. Fails on bot-blocked sites.

#### Tier 2.5: Exa.ai (Search-Based Extraction)

Requires `EXA_API_KEY`. Skipped if not set.

Uses Exa's `getContents()` with livecrawl + structured summary extraction to pull product data. Fills the cost/latency gap between server-side scrape (free but fails on bot-blocked sites) and Browserbase (works but expensive at ~$0.05-0.15/session). Exa costs ~$0.002/request and takes 5-15s.

If options are found, variant prices are resolved via `exa.searchAndContents()` with `includeDomains` filtering, finding indexed variant pages on the same domain. Results are filtered by word overlap with the base product name (>= 0.3 threshold) and merged with same-price filtering.

Returns `method: "exa"`. See `plans/19-exa-discovery.md` for the full spec.

#### Tier 3: Browserbase (Last Resort)

Launches a headless Chrome session via Browserbase. Stagehand LLM agent (Gemini 2.5 Flash) navigates the page, extracts product info and variant options from the rendered DOM.

For per-variant pricing, the agent selects each variant (clicking swatches, dropdowns) and reports the updated price. Uses the Stagehand Agent API with a system prompt that distinguishes variant selectors from quantity dropdowns. Caps at 3 variants per group, 10 total tasks.

Slowest tier (~30-120s), most expensive (Browserbase session + LLM API calls), but handles anti-bot sites (Amazon, Best Buy) and pages with no structured data.

### Step 2: Build Required Fields

The orchestrator always includes standard shipping fields (name, email, phone, street, apartment, city, state, zip, country) for physical products.

If the product has variant options, a `selections` field is added to `required_fields` with a label listing the option names (e.g., "Product options (Color, Size)").

### Step 3: Return Response

The orchestrator assembles the `QueryResponse` with product info, options, required fields, and which discovery tier was used.

## Code Path

### URL mode
```
POST /api/query { url }
  → packages/api/src/routes/query.ts            (branch: hasUrl → query())
  → packages/orchestrator/src/query.ts          (orchestrate)
    → packages/checkout/src/discover.ts
       → discoverProduct(url)                   (main entry point)
          → discoverViaFirecrawl(url)           [Tier 1 - packages/crawling]
          → scrapePriceWithOptions(url)         [Tier 2 - checkout]
          → discoverViaExa(url)                [Tier 2.5 - packages/crawling]
          → discoverViaBrowser(url)             [Tier 3 - checkout]
  → packages/api/src/formatters.ts              (formatQueryResponse)
```

### NL search mode
```
POST /api/query { query }
  → packages/api/src/routes/query.ts            (branch: hasQuery → searchQuery())
  → packages/orchestrator/src/search-query.ts   (orchestrate)
    → packages/crawling/src/nl-search.ts        (parseSearchQuery)
    → packages/crawling/src/exa-search.ts       (searchProducts via Exa searchAndContents)
    → filter by price, score, take top 5
  → packages/api/src/formatters.ts              (formatSearchQueryResponse)
```

## NL Search Mode Response

```json
{
  "type": "search",
  "query": "towels on amazon under $15",
  "products": [
    {
      "product": { "name": "...", "url": "...", "price": "12.99", "source": "amazon.com" },
      "options": [{ "name": "Color", "values": ["White", "Gray"] }],
      "required_fields": [ ... ],
      "discovery_method": "exa_search",
      "relevance_score": 0.94
    }
  ],
  "search_metadata": {
    "total_found": 5,
    "domain_filter": ["amazon.com"],
    "price_filter": { "max": 15 }
  }
}
```

The NL response has `"type": "search"` at the top level. URL mode responses do NOT have a `type` field (backward compatible).

## Error Cases

| Error | HTTP | When |
|-------|------|------|
| `MISSING_FIELD` | 400 | Neither `url` nor `query` provided, both provided, or query too short |
| `INVALID_URL` | 400 | URL path: fails `new URL()` validation |
| `QUERY_FAILED` | 502 | URL path: all discovery tiers failed |
| `SEARCH_NO_RESULTS` | 404 | NL path: Exa returned 0 results, or all failed price filter |
| `SEARCH_UNAVAILABLE` | 503 | NL path: EXA_API_KEY not set, or Exa error |
| `SEARCH_RATE_LIMITED` | 429 | NL path: Exa 429 rate limit |

## What Happens Next

The agent uses the query response to:
1. Show the user the product info and price
2. Collect the required fields (shipping, selections)
3. Call `POST /api/buy` with the URL, shipping, and selections to get a purchase quote
4. Call `POST /api/confirm` with the order_id to execute the purchase
