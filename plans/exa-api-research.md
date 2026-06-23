# Exa.ai API Research Report

> Compiled: 2026-03-05
> Purpose: Integration evaluation for product discovery tier in Bloon's e-commerce API

---

## Table of Contents

1. [API Overview](#1-api-overview)
2. [Endpoints Reference](#2-endpoints-reference)
3. [Structured Extraction (Summary + Schema)](#3-structured-extraction)
4. [Livecrawl & Content Freshness](#4-livecrawl--content-freshness)
5. [Rate Limits & Pricing](#5-rate-limits--pricing)
6. [Error Handling](#6-error-handling)
7. [TypeScript SDK](#7-typescript-sdk)
8. [Content Types Returned](#8-content-types-returned)
9. [Best Practices for Product Data Extraction](#9-best-practices-for-product-data-extraction)
10. [Integration Recommendations for Bloon](#10-integration-recommendations-for-bloon)

---

## 1. API Overview

**Base URL:** `https://api.exa.ai`

**Authentication:** API key via `x-api-key` header or `Authorization: Bearer <key>`

**Key obtained from:** https://dashboard.exa.ai/api-keys

**Environment variable:** `EXA_API_KEY`

### Available Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/search` | POST | Search the web (returns URLs + metadata) |
| `/contents` | POST | Get content from URLs (text, highlights, summary) |
| `/findSimilar` | POST | Find pages similar to a given URL |
| `/answer` | POST | Get synthesized answers with citations |
| `/research` | POST | Autonomous multi-step research tasks |

**Note:** There is NO separate `/search_and_contents` endpoint. The combined functionality is achieved by passing a `contents` object inside a `/search` request. The SDK exposes this as `searchAndContents()` for convenience but it hits the same `/search` endpoint.

---

## 2. Endpoints Reference

### 2.1 POST /search

The primary search endpoint. Returns ranked web results with optional inline content.

#### Request Body

```typescript
{
  // --- Query ---
  query: string;                    // Required. Natural language search query.
  type?: "auto" | "fast" | "neural" | "deep" | "deep-reasoning" | "instant";
                                     // Default: "auto". Selects search strategy.
  category?: "company" | "research paper" | "news" | "tweet"
           | "personal site" | "financial report" | "people" | "pdf";
  userLocation?: string;            // ISO 3166-1 alpha-2 country code (e.g. "US")
  useAutoprompt?: boolean;          // Auto-enhance the query

  // --- Result Control ---
  numResults?: number;              // Default: 10. Range: 1-100. Enterprise: up to 1000.

  // --- Domain Filtering ---
  includeDomains?: string[];        // Max 1200. Only return results from these domains.
  excludeDomains?: string[];        // Max 1200. Never return results from these domains.

  // --- Date Filtering ---
  startPublishedDate?: string;      // ISO 8601. Results published after this date.
  endPublishedDate?: string;        // ISO 8601. Results published before this date.
  startCrawlDate?: string;          // ISO 8601. Based on when Exa discovered the link.
  endCrawlDate?: string;            // ISO 8601.

  // --- Text Filtering ---
  includeText?: string[];           // Max 1 item, max 5 words. Must appear in page text.
  excludeText?: string[];           // Max 1 item, max 5 words. Must NOT appear (first 1000 words).

  // --- Content Moderation ---
  moderation?: boolean;             // Default: false. Filter unsafe content.

  // --- Deep Search Only ---
  additionalQueries?: string[];     // Max 5. Alternative query formulations. Deep/deep-reasoning only.
  outputSchema?: object;            // JSON Schema for structured output. Deep search only.

  // --- Inline Content Retrieval (makes this act as searchAndContents) ---
  contents?: ContentsOptions;       // See section 2.2 for full schema.
}
```

#### Response

```typescript
{
  requestId: string;
  resolvedSearchType: "neural" | "deep" | "deep-reasoning";
  searchTime: number;               // Milliseconds
  results: SearchResult[];
  costDollars: {
    total: number;
    breakDown: Array<{
      type: "search" | "contents";
      amount: number;
      breakdown: Record<string, number>;
    }>;
    perRequestPrices: Record<string, number>;
    perPagePrices: Record<string, number>;
  };
  // Deep search only:
  output?: {
    content: string | object;       // Matches outputSchema if provided
    grounding: Array<{
      field: string;                // JSONPath to output field
      citations: Array<{ url: string; title: string }>;
      confidence: "low" | "medium" | "high";
    }>;
  };
  statuses?: StatusEntry[];         // Per-URL content fetch statuses
}
```

#### SearchResult Fields

```typescript
{
  title: string;
  url: string;                      // Full URL
  id: string;                       // Temporary document ID (usable with /contents)
  publishedDate: string | null;     // ISO 8601 YYYY-MM-DD
  author: string | null;
  score: number;                    // Relevance score
  image: string;                    // Associated image URL
  favicon: string;                  // Domain favicon URL

  // Present only when contents requested:
  text?: string;                    // Full page content as markdown
  highlights?: string[];            // Relevant excerpts
  highlightScores?: number[];       // Cosine similarity per highlight
  summary?: string;                 // LLM-generated summary (or JSON string if schema provided)
  subpages?: SearchResult[];        // Crawled subpages
  extras?: {
    links?: string[];               // URLs found on the page
    imageLinks?: string[];          // Image URLs found on the page
  };
}
```

### 2.2 POST /contents (getContents)

Retrieve content from known URLs without searching.

#### Request Body

```typescript
{
  // One of these is required:
  ids?: string[];                   // Document IDs from a previous search
  urls?: string[];                  // Direct URLs to fetch

  // Content options (same as contents field in /search):
  text?: boolean | TextOptions;
  highlights?: boolean | HighlightsOptions;
  summary?: boolean | SummaryOptions;

  // Freshness control:
  maxAgeHours?: number;             // 0 = always livecrawl. -1 = never livecrawl. Positive = use cache if fresher.
  livecrawlTimeout?: number;        // Default: 10000 (ms)
  livecrawl?: "never" | "fallback" | "preferred" | "always";  // DEPRECATED. Use maxAgeHours.

  // Subpages:
  subpages?: number;                // Number of subpages to crawl (0 = none)
  subpageTarget?: string | string[];// Term to match for subpage selection

  // Extras:
  extras?: {
    links?: number;                 // Number of outbound URLs to return per page
    imageLinks?: number;            // Number of image URLs to return per page
  };

  filterEmptyResults?: boolean;
}
```

#### TextOptions

```typescript
{
  maxCharacters?: number;           // Limit text length
  includeHtmlTags?: boolean;        // Default: false. Preserve HTML structure.
  verbosity?: "compact" | "standard" | "full";  // Requires livecrawl: "always"
  includeSections?: SectionTag[];   // Requires livecrawl: "always"
  excludeSections?: SectionTag[];   // Requires livecrawl: "always"
}
// SectionTag = "header" | "navigation" | "banner" | "body" | "sidebar" | "footer" | "metadata"
```

#### HighlightsOptions

```typescript
{
  query?: string;                   // Custom query for highlight selection
  maxCharacters?: number;           // Limit total highlight text
  numSentences?: number;            // DEPRECATED
  highlightsPerUrl?: number;        // DEPRECATED
}
```

#### SummaryOptions (KEY FOR STRUCTURED EXTRACTION)

```typescript
{
  query?: string;                   // Directs the LLM summary focus
  schema?: object;                  // JSON Schema (Draft-07) for structured output
}
```

### 2.3 POST /findSimilar

Find pages similar to a given URL.

```typescript
{
  url: string;                      // Required. The reference URL.
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  excludeSourceDomain?: boolean;    // Exclude the domain of the input URL
  startPublishedDate?: string;
  endPublishedDate?: string;
  startCrawlDate?: string;
  endCrawlDate?: string;
  category?: string;
  contents?: ContentsOptions;       // Same inline content retrieval
}
```

### 2.4 POST /answer

Generate synthesized answers with citations.

```typescript
{
  query: string;
  text?: boolean;                   // Include source text
  model?: "exa";
  stream?: boolean;
  systemPrompt?: string;
  outputSchema?: object;            // JSON Schema for structured response
  userLocation?: string;
}
```

---

## 3. Structured Extraction

### How summary + schema Works

The `summary` field accepts a JSON Schema (Draft-07) that shapes the LLM output. The LLM (Gemini Flash under the hood) reads the page content and produces a JSON object matching the schema.

**The summary is returned as a JSON string** -- you must `JSON.parse()` it to get the structured object.

### Example: Product Data Extraction

```typescript
// Using the SDK
const results = await exa.searchAndContents(
  "Nike Air Max 90 sneakers",
  {
    numResults: 5,
    includeDomains: ["nike.com", "footlocker.com", "amazon.com"],
    contents: {
      summary: {
        query: "Extract product name, price, currency, availability, and description",
        schema: {
          type: "object",
          properties: {
            product_name: { type: "string", description: "Full product name" },
            price: { type: "number", description: "Price as a number" },
            currency: { type: "string", description: "ISO 4217 currency code" },
            in_stock: { type: "boolean", description: "Whether the product is in stock" },
            description: { type: "string", description: "Product description" },
            image_url: { type: "string", description: "Main product image URL" },
            variants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  size: { type: "string" },
                  color: { type: "string" },
                  available: { type: "boolean" }
                }
              }
            }
          },
          required: ["product_name", "price", "currency"]
        }
      },
      text: { maxCharacters: 2000 }  // Also get raw text as fallback
    }
  }
);

// Parse the structured summary
for (const result of results.results) {
  if (result.summary) {
    const product = JSON.parse(result.summary);
    console.log(product.product_name, product.price, product.currency);
  }
}
```

### Using Raw HTTP

```bash
curl -X POST 'https://api.exa.ai/search' \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Nike Air Max 90",
    "numResults": 5,
    "includeDomains": ["nike.com"],
    "contents": {
      "summary": {
        "query": "Extract product details",
        "schema": {
          "type": "object",
          "properties": {
            "product_name": { "type": "string" },
            "price": { "type": "number" },
            "currency": { "type": "string" },
            "in_stock": { "type": "boolean" }
          },
          "required": ["product_name", "price"]
        }
      }
    }
  }'
```

### Deep Search with outputSchema (Alternative)

For deep search, use `outputSchema` at the top level instead of `summary.schema`. This returns a synthesized answer across all results, not per-page extraction.

```typescript
const results = await exa.search(
  "What are the top Nike running shoes under $150?",
  {
    type: "deep",
    outputSchema: {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              price: { type: "number" },
              url: { type: "string" }
            }
          }
        }
      }
    },
    contents: { text: true }
  }
);
// results.output.content is the structured object
// results.output.grounding has per-field citations with confidence
```

### Schema Constraints (Deep Search)

- Max nesting depth: 2
- Max properties: 10
- Supports JSON Schema Draft-07

### Reliability Notes

- `summary.schema` extraction is per-page and depends on page content quality
- Works best on well-structured product pages (Shopify, Amazon, etc.)
- May return partial data if the page doesn't contain all requested fields
- The `query` parameter in summary significantly improves extraction accuracy
- Always validate parsed JSON and handle missing fields gracefully

---

## 4. Livecrawl & Content Freshness

### maxAgeHours (Preferred)

| Value | Behavior |
|-------|----------|
| `0` | Always livecrawl. Guaranteed fresh content. Slower. |
| `-1` | Never livecrawl. Cache-only. Fastest but may be stale. |
| Positive integer (e.g. `24`) | Use cache if content is newer than N hours, otherwise livecrawl. |
| Not set | Exa decides based on content age heuristics. |

### livecrawl (DEPRECATED -- use maxAgeHours)

| Value | Behavior |
|-------|----------|
| `never` | Only return cached content. Equivalent to `maxAgeHours: -1`. |
| `fallback` | Use cache first, livecrawl if cache miss. |
| `preferred` | Prefer livecrawl, fall back to cache on timeout. |
| `always` | Always livecrawl. Required for verbosity/section filtering. Equivalent to `maxAgeHours: 0`. |

### livecrawlTimeout

- Default: `10000` (10 seconds)
- Configurable in milliseconds
- If livecrawl times out and `livecrawl` was `fallback` or `preferred`, cached content is returned
- If `always` and timeout, returns `CRAWL_LIVECRAWL_TIMEOUT` error

### Key Points for Product Discovery

- **Use `maxAgeHours: 0`** for price-sensitive data (prices change frequently)
- **Use `maxAgeHours: 24`** for product metadata that rarely changes
- Content filtering (verbosity, sections) requires `livecrawl: "always"` or `maxAgeHours: 0`
- Livecrawl adds latency (500ms-10s depending on target site)

---

## 5. Rate Limits & Pricing

### Rate Limits

| Endpoint | Limit | Type |
|----------|-------|------|
| `/search` | 10 QPS | Queries per second |
| `/contents` | 100 QPS | Queries per second |
| `/answer` | 10 QPS | Queries per second |
| `/research` | 15 concurrent | Concurrent tasks |

- Enterprise plans offer custom QPS limits (can reach 100s of QPS for search)
- Rate limit exceeded returns HTTP `429 TOO_MANY_REQUESTS`
- No documented retry-after headers

### Pricing

| Operation | Cost |
|-----------|------|
| **Search** (1-10 results) | $7 / 1,000 requests |
| Each additional result beyond 10 | $1 / 1,000 results |
| **Deep Search** | $12 / 1,000 requests |
| Deep Search + Reasoning | +$3 / 1,000 requests ($15 total) |
| **Contents** (text/highlights) | $1 / 1,000 pages |
| **Summary** (per page) | Additional cost (included in costDollars response) |
| **Answer** | $5 / 1,000 answers |
| **Free tier** | 1,000 requests/month |

### Cost Calculation for Product Discovery

For a typical product discovery flow (search + contents with summary):
- 1 search request (10 results): $0.007
- 10 pages of content + summary: ~$0.01-0.02
- **Total per query: ~$0.02-0.03**

At scale (1000 product lookups/day):
- ~$20-30/day or ~$600-900/month

### Subscription Tiers

| Tier | Price | Credits |
|------|-------|---------|
| Free | $0 | 1,000 requests/month |
| Starter | $49/month | 8,000 credits |
| Pro | $449/month | 100,000 credits |
| Enterprise | Custom | Custom + SLA + high QPS |

### Grants

- $1,000 in free credits available for startups and education projects

---

## 6. Error Handling

### HTTP-Level Errors

| Status | Tag | Description |
|--------|-----|-------------|
| 400 | `INVALID_REQUEST_BODY` | Malformed JSON, missing fields, invalid values |
| 400 | `INVALID_REQUEST` | Conflicting parameters |
| 400 | `INVALID_URLS` | Malformed URL/ID values |
| 400 | `INVALID_NUM_RESULTS` | numResults > 100 with highlights |
| 400 | `INVALID_JSON_SCHEMA` | Invalid schema in /answer |
| 400 | `NO_CONTENT_FOUND` | URLs yielded no content |
| 400 | `NUM_RESULTS_EXCEEDED` | Request exceeds plan limit |
| 401 | `INVALID_API_KEY` | Missing or malformed API key |
| 402 | `NO_MORE_CREDITS` | Account credits exhausted |
| 402 | `API_KEY_BUDGET_EXCEEDED` | Spending limit reached |
| 403 | `ACCESS_DENIED` | Feature requires higher plan |
| 403 | `FEATURE_DISABLED` | Plan doesn't support feature |
| 403 | `ROBOTS_FILTER_BLOCKED` | URL blocked by robots.txt |
| 403 | `PROHIBITED_CONTENT` | Content moderation blocked |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Duplicate externalId |
| 422 | `FETCH_DOCUMENT_ERROR` | URL processing failed |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded (no requestId) |
| 500 | `DEFAULT_ERROR` / `INTERNAL_ERROR` | Server error |
| 501 | `UNABLE_TO_GENERATE_RESPONSE` | /answer couldn't generate output |
| 502 | `BAD_GATEWAY` | Upstream failure |
| 503 | `SERVICE_UNAVAILABLE` | Temporary downtime |

### Per-URL Statuses Array

When fetching content for multiple URLs, individual failures appear in the `statuses` array rather than causing the entire request to fail.

```typescript
{
  statuses: [
    { id: "url-or-doc-id", status: "success" },
    {
      id: "url-or-doc-id",
      status: "error",
      error: {
        tag: "CRAWL_NOT_FOUND",    // Error type
        httpStatusCode: 404         // Original HTTP status
      }
    }
  ]
}
```

#### Content Fetch Error Tags

| Tag | HTTP Code | Description | Action |
|-----|-----------|-------------|--------|
| `CRAWL_NOT_FOUND` | 404 | Page not found | Verify URL is accessible |
| `CRAWL_TIMEOUT` | 408 | Fetch timed out | Retry or increase timeout |
| `CRAWL_LIVECRAWL_TIMEOUT` | -- | Livecrawl specifically timed out | Use `livecrawl: "fallback"` or increase `livecrawlTimeout` |
| `SOURCE_NOT_AVAILABLE` | 403 | Paywall or auth required | Try alternative URL |
| `UNSUPPORTED_URL` | -- | Non-HTTP URL | Use HTTP/HTTPS only |
| `CRAWL_UNKNOWN_ERROR` | 500+ | Unknown failure | Retry; escalate if persistent |

### Error Response Shape

```json
{
  "requestId": "abc-123",
  "error": "Human-readable error message",
  "tag": "INVALID_REQUEST_BODY"
}
```

### Best Practices

- Always check `statuses` array when using `/contents` with multiple URLs
- Use `requestId` when contacting Exa support
- Implement exponential backoff for 429 errors
- Handle partial failures gracefully (some URLs succeed, others fail)

---

## 7. TypeScript SDK

### Package Info

| Field | Value |
|-------|-------|
| **npm package** | `exa-js` |
| **Latest version** | 1.5.13 (as of March 2025) |
| **License** | MIT |
| **Repository** | https://github.com/exa-labs/exa-js |
| **TypeScript** | Full type coverage included |
| **Env variable** | `EXA_API_KEY` |

### Installation

```bash
npm install exa-js
# or
pnpm add exa-js
```

### Initialization

```typescript
import Exa from "exa-js";

// Auto-reads EXA_API_KEY from environment
const exa = new Exa();

// Or explicit
const exa = new Exa("your-api-key");
```

### Core Methods

```typescript
// Search only (no content)
const searchResults = await exa.search(query, options);

// Search + inline content retrieval (single request)
const results = await exa.searchAndContents(query, {
  numResults: 10,
  includeDomains: ["amazon.com"],
  text: true,
  highlights: { maxCharacters: 500 },
  summary: { query: "Extract product info", schema: { ... } }
});

// Get content for known URLs
const contents = await exa.getContents(
  ["https://example.com/product/123"],
  {
    text: { maxCharacters: 5000 },
    summary: { query: "Product details", schema: productSchema }
  }
);

// Find similar pages
const similar = await exa.findSimilar("https://example.com/product", {
  numResults: 10,
  excludeSourceDomain: true
});

// Combined
const similarWithContent = await exa.findSimilarAndContents(url, options);

// Answer with citations
const answer = await exa.answer("What is the best laptop under $1000?");

// Stream answer
for await (const chunk of exa.streamAnswer(query)) {
  process.stdout.write(chunk.content);
}

// Research (async)
const research = await exa.research.create({ instructions: "..." });
const result = await exa.research.pollUntilFinished(research.researchId);
```

### Type Imports

```typescript
import type {
  SearchResponse,
  RegularSearchOptions,
  SearchResult,
  ContentsOptions,
  TextContentsOptions,
  HighlightsContentsOptions,
  SummaryContentsOptions,
} from "exa-js";
```

### SDK vs Raw HTTP

| Aspect | SDK (`exa-js`) | Raw HTTP |
|--------|----------------|----------|
| Type safety | Full TypeScript types | Manual typing needed |
| Convenience | `searchAndContents()` single call | Must embed `contents` in search body |
| Auth | Auto-reads `EXA_API_KEY` | Manual header setup |
| Streaming | Built-in AsyncGenerator | Manual SSE parsing |
| Error handling | Throws typed errors | Manual status code handling |
| Bundle size | Small (minimal deps) | Zero additional deps |
| Flexibility | Covers all endpoints | Full control over requests |

**Recommendation for Bloon:** Use the SDK. The type safety and convenience methods justify the minimal dependency. The SDK is MIT-licensed and actively maintained.

---

## 8. Content Types Returned

### text

- **Format:** Markdown (HTML converted to markdown, noise filtered)
- **Content:** Main page content with structure preserved
- **Options:** `maxCharacters`, `includeHtmlTags`, `verbosity`, `includeSections`/`excludeSections`
- **Best for:** Raw content analysis, fallback parsing

### highlights

- **Format:** Array of strings (relevant excerpts)
- **Content:** Query-relevant passages extracted from the page
- **Scoring:** Each highlight has a `highlightScores` cosine similarity value
- **Options:** `query` (custom highlight selection), `maxCharacters`
- **Best for:** Quick relevance assessment, snippet display

### summary

- **Format:** String (plain text or JSON string if schema provided)
- **Content:** LLM-generated abstractive summary (Gemini Flash)
- **Options:** `query` (focus direction), `schema` (JSON Schema for structured output)
- **Best for:** Structured data extraction, product info parsing
- **IMPORTANT:** When `schema` is provided, the string contains valid JSON that must be parsed

### extras.links

- **Format:** Array of URL strings
- **Content:** Outbound links found on the page

### extras.imageLinks

- **Format:** Array of URL strings
- **Content:** Image URLs found on the page

### subpages

- **Format:** Nested array of SearchResult objects
- **Content:** Crawled subpages matching `subpageTarget`

---

## 9. Best Practices for Product Data Extraction

### Recommended Product Schema

```typescript
const productSchema = {
  type: "object",
  properties: {
    product_name: {
      type: "string",
      description: "Full product name including brand"
    },
    price: {
      type: "number",
      description: "Current price as a decimal number (e.g. 29.99)"
    },
    currency: {
      type: "string",
      description: "ISO 4217 currency code (e.g. USD, EUR, GBP)"
    },
    original_price: {
      type: "number",
      description: "Original price before discount, if applicable"
    },
    in_stock: {
      type: "boolean",
      description: "Whether the product is currently available for purchase"
    },
    description: {
      type: "string",
      description: "Brief product description (1-2 sentences)"
    },
    image_url: {
      type: "string",
      description: "URL of the main product image"
    },
    brand: {
      type: "string",
      description: "Brand or manufacturer name"
    },
    category: {
      type: "string",
      description: "Product category (e.g. Electronics, Clothing)"
    },
    shipping_required: {
      type: "boolean",
      description: "Whether this is a physical product requiring shipping"
    }
  },
  required: ["product_name", "price", "currency"]
};
```

### Strategy for Different URL Types

#### Known Product URL (direct URL from agent)

```typescript
// Use getContents -- no search needed, just extract
const result = await exa.getContents([productUrl], {
  text: { maxCharacters: 3000 },
  summary: {
    query: "Extract the product name, current price, currency, availability, and description",
    schema: productSchema
  },
  maxAgeHours: 0  // Always fresh for price accuracy
});
```

#### Product Search (find products by name)

```typescript
// Use searchAndContents with domain filtering
const results = await exa.searchAndContents(
  `${productName} buy price`,
  {
    numResults: 5,
    includeDomains: [
      "amazon.com", "walmart.com", "target.com",
      "bestbuy.com", "ebay.com", "shopify.com"
    ],
    contents: {
      summary: {
        query: "Extract product details including exact price",
        schema: productSchema
      }
    }
  }
);
```

### Tips

1. **Always include a `query` in `summary`** -- it dramatically improves extraction accuracy by telling the LLM what to focus on.

2. **Use `maxAgeHours: 0` for prices** -- product prices change frequently. Cached content may have outdated prices.

3. **Keep schemas simple** -- max 10 properties, max nesting depth 2 (for deep search). Simpler schemas produce more reliable extractions.

4. **Validate the parsed JSON** -- the summary is a JSON string. Always wrap in try/catch and handle partial extractions:

```typescript
function parseProductSummary(summary: string | undefined): Partial<Product> | null {
  if (!summary) return null;
  try {
    const parsed = JSON.parse(summary);
    // Validate required fields
    if (!parsed.product_name || typeof parsed.price !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
```

5. **Use `text` as fallback** -- if summary extraction fails, fall back to parsing the markdown text with your own LLM (Gemini Flash, as Bloon already uses it).

6. **Domain filtering is powerful** -- `includeDomains` with known e-commerce sites dramatically improves result quality. Exa supports up to 1200 domains.

7. **Handle the `statuses` array** -- individual URLs can fail even when the request succeeds. Check for `CRAWL_NOT_FOUND` (dead links), `SOURCE_NOT_AVAILABLE` (paywalled), and `CRAWL_TIMEOUT`.

8. **Use `findSimilar` for alternatives** -- given a product URL, find similar products on other retailers.

---

## 10. Integration Recommendations for Bloon

### Architecture: Exa as Discovery Tier

Exa fits naturally as a tier in Bloon's 3-tier discovery pipeline (per `plans/17-query-endpoint.md`):

```
Tier 1: Firecrawl (primary, direct URL scraping)
Tier 2: Exa (search-based discovery + structured extraction)
Tier 3: Browserbase + Gemini (fallback for JS-heavy/protected pages)
```

### When to Use Exa vs Firecrawl

| Scenario | Use |
|----------|-----|
| Agent provides exact product URL | Firecrawl (direct scrape) |
| Agent provides product name, no URL | **Exa search** |
| Firecrawl scrape fails (anti-bot, JS-heavy) | **Exa getContents** (livecrawl) |
| Need to find cheapest price across retailers | **Exa search** with includeDomains |
| Need to verify a product exists | **Exa search** with exact URL domain |

### Implementation Sketch

```typescript
// packages/crawling/src/exa-adapter.ts
import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY);

const PRODUCT_SCHEMA = {
  type: "object" as const,
  properties: {
    product_name: { type: "string" as const },
    price: { type: "number" as const },
    currency: { type: "string" as const },
    in_stock: { type: "boolean" as const },
    description: { type: "string" as const },
    image_url: { type: "string" as const },
    shipping_required: { type: "boolean" as const },
  },
  required: ["product_name", "price", "currency"],
};

export async function extractWithExa(url: string) {
  const result = await exa.getContents([url], {
    text: { maxCharacters: 3000 },
    summary: {
      query: "Extract the product name, exact current price, currency, stock availability, description, main image URL, and whether shipping is required",
      schema: PRODUCT_SCHEMA,
    },
    maxAgeHours: 0,
    livecrawlTimeout: 15000,
  });

  const page = result.results[0];
  if (!page?.summary) return null;

  try {
    return JSON.parse(page.summary);
  } catch {
    return null;
  }
}

export async function searchProducts(query: string, domains?: string[]) {
  return exa.searchAndContents(query, {
    numResults: 5,
    includeDomains: domains ?? [
      "amazon.com", "walmart.com", "target.com",
      "bestbuy.com", "nike.com", "adidas.com",
    ],
    contents: {
      summary: {
        query: "Extract product details including exact price",
        schema: PRODUCT_SCHEMA,
      },
    },
  });
}
```

### Cost Impact

At Bloon's expected v1 volume (~100 requests/day):
- Search: ~$0.70/day ($21/month)
- Contents: ~$0.10/day ($3/month)
- **Total: ~$24/month** (well within Starter tier at $49/month)

### Environment Variable

Add to `.env`:
```
EXA_API_KEY=your-key-here
```

---

## Sources

- [Exa API Search Reference](https://exa.ai/docs/reference/search)
- [Exa Contents Retrieval](https://exa.ai/docs/reference/contents-retrieval)
- [Exa TypeScript SDK Specification](https://exa.ai/docs/sdks/typescript-sdk-specification)
- [Exa Error Codes](https://exa.ai/docs/reference/error-codes)
- [Exa Rate Limits](https://exa.ai/docs/reference/rate-limits)
- [Exa Pricing](https://exa.ai/pricing)
- [Exa Pricing Update Changelog](https://exa.ai/docs/changelog/pricing-update)
- [exa-js on npm](https://www.npmjs.com/package/exa-js)
- [exa-js on GitHub](https://github.com/exa-labs/exa-js)
- [Exa vs Perplexity API](https://exa.ai/versus/perplexity)
