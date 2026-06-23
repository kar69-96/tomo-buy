# Natural Language Search — POST /api/query { query }

## Overview

`POST /api/query` accepts either `{ url }` (existing URL-based discovery) or `{ query }` (new natural language search). The two fields are mutually exclusive.

NL search lets agents describe what they want in plain English — `"towels on amazon under $15"` — and get back up to 5 ranked product results with full product info, options, required fields, and route.

**Primary approach:** Exa `searchAndContents()` — returns product links + structured LLM extraction in a single API call (~$0.02–0.05 for 5 results, ~5–20s).

---

## Request

```bash
# NL search (new)
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "towels on amazon under $15"}'

# URL-based discovery (unchanged)
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"url": "https://allbirds.com/products/mens-tree-runners"}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | one-of | Product URL or x402 endpoint |
| `query` | string | one-of | Natural language product query |

Sending **both** `url` and `query` returns `400 MISSING_FIELD`. Sending **neither** returns `400 MISSING_FIELD`.

---

## NL Query Parsing

Queries are parsed deterministically — no LLM call. Three things are extracted:

### Domain filter

| Phrase | Resolved domain |
|--------|----------------|
| `on amazon` | `amazon.com` |
| `from target` | `target.com` |
| `at walmart` | `walmart.com` |
| `on best buy` | `bestbuy.com` |
| `from home depot` | `homedepot.com` |
| `nike.com` (direct) | `nike.com` |
| …and 15+ more | see `nl-search.ts` |

Domains are passed as `includeDomains` to Exa, which restricts search results to that domain.

### Price constraints

| Phrase pattern | Effect |
|---------------|--------|
| `under $15`, `below $20`, `less than $30` | `maxPrice: 15` |
| `over $10`, `above $5`, `more than $8` | `minPrice: 10` |
| `$10-$20`, `$10 to $20` | `minPrice: 10, maxPrice: 20` |
| `between $5 and $15` | `minPrice: 5, maxPrice: 15` |

Products outside the range are filtered before ranking.

### Cleaned terms

Domain and price phrases are stripped. `"towels on amazon under $15"` → cleaned terms: `"towels"`. The cleaned terms are what get sent to Exa.

---

## Search Pipeline

```
POST /api/query { query }
  → packages/api/src/routes/query.ts
  → packages/orchestrator/src/search-query.ts
    1. parseSearchQuery()          → domains, price bounds, cleaned terms
    2. searchProducts()            → Exa searchAndContents (8 candidates)
    3. filter by price bounds
    4. score = exa_relevance + completeness_bonus
    5. sort desc, take top 5
    6. buildRequiredFields()       → standard shipping + selections if options
  → formatSearchQueryResponse()   → add source hostname per product
```

### Exa search call

```typescript
exa.searchAndContents(cleanedTerms, {
  includeDomains: ["amazon.com"],  // if domain extracted
  numResults: 8,
  type: "neural",
  summary: {
    query: "Extract product details as structured JSON",
    schema: SEARCH_PRODUCT_SCHEMA,
  },
})
```

Each result's `summary` is parsed as JSON containing: `name`, `price`, `original_price`, `currency`, `brand`, `image_url`, `options`.

### Validation

Results are dropped if:
- `summary` is missing or not valid JSON
- `name` is missing
- `price` is missing, zero, or non-numeric

### Scoring

```
score = exa_relevance_score + completeness_bonus
completeness_bonus:
  +0.03 if image_url present
  +0.02 if options.length > 0
  +0.02 if brand present
  +0.01 if original_price present
```

Scores are rounded to 2 decimal places in the response.

---

## Response

```json
{
  "type": "search",
  "query": "towels on amazon under $15",
  "products": [
    {
      "product": {
        "name": "Amazon Basics Quick-Dry Towels",
        "url": "https://amazon.com/dp/B08EXAMPLE",
        "price": "12.99",
        "source": "amazon.com",
        "brand": "Amazon Basics",
        "image_url": "https://m.media-amazon.com/images/...",
        "currency": "USD"
      },
      "options": [
        { "name": "Color", "values": ["White", "Beige", "Gray"] },
        { "name": "Size", "values": ["Hand", "Bath", "Bath Sheet"] }
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
      "route": "browserbase",
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

### Response fields

| Field | Description |
|-------|-------------|
| `type` | Always `"search"` for NL queries. Absent for URL-based queries (backward compat). |
| `query` | The original raw query string |
| `products` | Up to 5 ranked results |
| `products[].product` | Product info with `source` (hostname) added |
| `products[].options` | Variant groups (Color, Size, etc.) |
| `products[].required_fields` | Always includes standard shipping fields. Adds `selections` if options exist. |
| `products[].route` | Always `"browserbase"` — NL search results go through browser checkout |
| `products[].discovery_method` | Always `"exa_search"` |
| `products[].relevance_score` | 0.0–1.0, higher = more relevant |
| `search_metadata.total_found` | Count of returned products (≤5) |
| `search_metadata.domain_filter` | Which domains were searched, if any |
| `search_metadata.price_filter` | `{ min?, max? }` — omitted if no price constraint |

---

## Using Search Results for Purchase

Each product in the results is ready for `POST /api/buy`:

```bash
# 1. Search
curl -X POST http://localhost:3000/api/query \
  -d '{"query":"towels on amazon under $15"}'

# 2. Buy the first result (use product.url)
curl -X POST http://localhost:3000/api/buy \
  -d '{
    "url": "https://amazon.com/dp/B08EXAMPLE",
    "shipping": { ... },
    "selections": { "Color": "White", "Size": "Bath" }
  }'

# 3. Confirm
curl -X POST http://localhost:3000/api/confirm \
  -d '{"order_id":"bloon_ord_xyz"}'
```

The `required_fields` in each search result tells the agent exactly what to collect before calling `buy`.

---

## Error Codes

| Code | HTTP | When |
|------|------|------|
| `MISSING_FIELD` | 400 | Query is empty, too short, or both/neither url+query sent |
| `SEARCH_NO_RESULTS` | 404 | Exa returned 0 results, or all results failed price filter |
| `SEARCH_UNAVAILABLE` | 503 | `EXA_API_KEY` not set, or Exa returned an unexpected error |
| `SEARCH_RATE_LIMITED` | 429 | Exa returned 429 rate limit |

---

## Files

| File | Role |
|------|------|
| `packages/crawling/src/nl-search.ts` | Parse NL query → domains, price bounds, cleaned terms |
| `packages/crawling/src/exa-client.ts` | Shared Exa client singleton (used by extract + search) |
| `packages/crawling/src/exa-search.ts` | `searchProducts()` — Exa searchAndContents wrapper |
| `packages/orchestrator/src/search-query.ts` | `searchQuery()` — full orchestration |
| `packages/api/src/routes/query.ts` | Route branching: url vs query |
| `packages/api/src/formatters.ts` | `formatSearchQueryResponse()` |
| `packages/api/src/error-handler.ts` | SEARCH_* error → HTTP status mapping |
| `packages/core/src/types.ts` | `SearchProductResult`, `SearchQueryResponse`, new error codes |

---

## Env Vars

| Var | Required | Description |
|-----|----------|-------------|
| `EXA_API_KEY` | Yes (for search) | If missing, returns `SEARCH_UNAVAILABLE` |
| `EXA_SEARCH_TIMEOUT_MS` | No (default: 20000) | Timeout for Exa searchAndContents |

---

## Cost & Latency

| Metric | Typical |
|--------|---------|
| Exa API cost | ~$0.02–0.05 for 8 candidates |
| Latency | 5–20s |
| Results returned | Up to 5 (from 8 candidates) |

No per-URL Firecrawl or Browserbase enrichment — too slow/expensive for multi-product queries.

---

## Limitations

- **No variant price resolution** — search results include options but not per-variant prices. The actual prices are resolved when `POST /api/buy` runs product discovery on the specific URL.
- **Exa index freshness** — results reflect Exa's crawl index, not real-time inventory. Out-of-stock products may appear.
- **Max $25 still applies** — the purchase cap is enforced at buy/confirm time, not at search time.
- **URL path** is always `browserbase` route — x402 products are not discoverable via NL search.
