# Exa.ai Discovery Stage (Stage 2.5)

Exa.ai is inserted as **Stage 2.5** in the query endpoint's product discovery pipeline — after server-side scrape, before Browserbase+Stagehand. It fills the cost/latency gap between free scrape (fails on bot-blocked sites) and Browserbase (~$0.05-0.15/session, 30-120s).

## Why Exa

| | Scrape (Stage 2) | Exa (Stage 2.5) | Browserbase (Stage 3) |
|---|---|---|---|
| Cost | Free | ~$0.002/req | ~$0.05-0.15/session |
| Latency | 1-2s | 5-15s | 30-120s |
| Bot-blocked sites | Fails | Works (livecrawl) | Works (headless Chrome) |
| JS-heavy pages | Fails | Works | Works |

## Pipeline Position

```
Stage 0:   Route Detection (x402)
Stage 1:   Firecrawl (primary, up to 3 attempts + Browserbase+Gemini repair)
Stage 2:   Server-Side Scrape (free, fast, JSON-LD + meta tags)
Stage 2.5: Exa.ai (NEW - livecrawl + LLM structured extraction)
Stage 3:   Browserbase + Stagehand (last resort, full headless Chrome)
```

## Implementation

**File:** `packages/crawling/src/exa-extract.ts`

### Product Extraction

`discoverViaExa(url)` is the entry point:

1. Guard: return `null` if no `EXA_API_KEY` (tier skipped gracefully)
2. Call `exa.getContents([url])` with:
   - `summary.schema` — structured extraction matching FirecrawlExtract shape
   - `livecrawl: "always"` — forces fresh crawl
   - `livecrawlTimeout: 15000` — 15s max for livecrawl
3. Parse summary JSON, validate name + price via `isValidPrice()`
4. If options found, attempt variant resolution (best-effort)
5. Return `FullDiscoveryResult` with `method: "exa"`

### Variant Resolution

`resolveVariantPricesViaExa()` uses Exa's search to find variant pages:

1. Call `exa.searchAndContents(productName, { includeDomains: [domain] })`
2. Filter by word overlap with base product name (>= 0.3 threshold)
3. Match option values via `valuesLikelyMatch()` (reused from variant.ts)
4. Build per-option price maps, apply same-price filter
5. Errors are swallowed — base result returned without variant prices

### Extraction Schema

Uses `type: "string"` for all fields (including prices) to match the existing convention. Options are extracted as a JSON string that gets parsed client-side:

```typescript
const PRODUCT_SCHEMA = {
  name: { type: "string", required: true },
  price: { type: "string", required: true },
  original_price: { type: "string" },
  currency: { type: "string" },
  brand: { type: "string" },
  image_url: { type: "string" },
  description: { type: "string" },
  options: { type: "string" },  // JSON array of {name, values[]}
};
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXA_API_KEY` | — | Exa.ai API key. Tier skipped if not set. |
| `EXA_LIVECRAWL_TIMEOUT_MS` | `15000` | Livecrawl timeout for base product extraction |
| `EXA_MAX_VARIANT_RESULTS` | `10` | Max variant pages to fetch via search |
| `EXA_EXTRACT_TIMEOUT_MS` | `20000` | Overall timeout for the Exa getContents call |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No `EXA_API_KEY` | Return `null`, skip tier |
| `ProductNotFoundError` (404) | Re-throw (handled by caller) |
| 403 / blocked | Return `null` (fall to Browserbase) |
| Timeout | Return `null` |
| HTTP 429 (rate limit) | Return `null` after logging |
| Invalid/missing name or price | Return `null` |
| Variant search fails | Swallow error, return base result |
| Network error | Catch, return `null` |

## Reused Code

From `helpers.ts`: `stripCurrencySymbol()`, `isValidPrice()`, `mapOptions()`, `computeWordOverlap()`
From `variant.ts`: `valuesLikelyMatch()` (newly exported)
From `constants.ts`: `ProductNotFoundError`

## Integration Point

In `packages/checkout/src/discover.ts`, `discoverProduct()`:

```typescript
// Stage 2.5: Exa (search-based extraction)
const exaResult = await discoverViaExa(url);
if (exaResult) return exaResult;
```
