# API Reference — REST Endpoints

**Base URL:** `http://localhost:3000` (dev)
**Auth:** None (single operator).
**Content-Type:** `application/json`

> **Architecture note:** Bloon uses credit card via browser checkout only. The blockchain/USDC/wallet/x402 system has been removed. There are 3 endpoints: `POST /api/query`, `POST /api/buy`, `POST /api/confirm`.

---

## POST /api/query

Discover product info, options, and required fields. Accepts either a product URL or a natural language query. No wallet needed.

### URL-based discovery (existing)

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://allbirds.com/products/mens-tree-runners" }'
```

| Field | Type | One-of | Description |
|-------|------|--------|-------------|
| `url` | string | yes | Product URL |
| `query` | string | yes | Natural language product search |

Sending **both** `url` and `query` returns `400 MISSING_FIELD`. Sending **neither** returns `400 MISSING_FIELD`.

**200 OK (URL path):**
```json
{
  "product": {
    "name": "Men's Tree Runners",
    "url": "https://allbirds.com/products/mens-tree-runners",
    "price": "98.00",
    "source": "allbirds.com",
    "image_url": "https://cdn.allbirds.com/...",
    "brand": "Allbirds",
    "currency": "USD"
  },
  "options": [
    {
      "name": "Color",
      "values": ["Charcoal", "Navy", "White"],
      "prices": { "Charcoal": "98.00", "Navy": "98.00", "White": "98.00" }
    },
    { "name": "Size", "values": ["8", "9", "10", "11", "12"] }
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

**400:** `INVALID_URL`, `MISSING_FIELD`
**502:** `QUERY_FAILED`

### Natural language search (new)

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{ "query": "towels on amazon under $15" }'
```

The query is parsed to extract domain filters (`on amazon` → `amazon.com`), price constraints (`under $15` → `maxPrice: 15`), and cleaned search terms. Exa `searchAndContents()` is called and returns up to 5 ranked product results.

**200 OK (NL search path):**
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
        "image_url": "https://m.media-amazon.com/..."
      },
      "options": [
        { "name": "Color", "values": ["White", "Gray"] }
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
        { "field": "selections", "label": "Product options (Color)" }
      ],
      "discovery_method": "exa_search",
      "relevance_score": 0.94
    }
  ],
  "search_metadata": {
    "total_found": 1,
    "domain_filter": ["amazon.com"],
    "price_filter": { "max": 15 }
  }
}
```

NL search response always has `"type": "search"`. URL-based response has no `type` field (backward compatible).

**400:** `MISSING_FIELD` (empty/whitespace query, or both url+query sent)
**404:** `SEARCH_NO_RESULTS`
**429:** `SEARCH_RATE_LIMITED`
**503:** `SEARCH_UNAVAILABLE`

> See `plans/22-nl-search.md` for the full NL search spec.

### Discovery Pipeline (URL path)

The URL-based query endpoint runs a multi-tier discovery pipeline:

1. **Firecrawl (Tier 1)** — Up to 3 attempts with exponential backoff. Parser ensemble scores candidates. Browserbase+Gemini repair if confidence < 0.75.
2. **Exa.ai (Tier 2.5)** — Runs in parallel with Firecrawl. Livecrawl + structured extraction. Handles bot-blocked sites.
3. **Server-side scrape (Tier 2)** — JSON-LD + meta tag parsing. Free and fast.
4. **Browserbase + Stagehand (Tier 3)** — Headless Chrome agent extracts product info. Slowest but most accurate.

The `discovery_method` field indicates which tier succeeded: `"firecrawl"`, `"exa"`, `"scrape"`, or `"browserbase"`.

---

## POST /api/buy

Get a purchase quote for a URL. Does NOT charge the card or execute the purchase.

```bash
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://amazon.com/dp/B08EXAMPLE",
    "shipping": {
      "name": "Jane Doe",
      "street": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701",
      "country": "US",
      "email": "jane@example.com",
      "phone": "512-555-0100"
    }
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Product URL |
| `shipping` | object | no | Shipping address. Required for physical products. Returns `SHIPPING_REQUIRED` if needed and not provided. Falls back to .env defaults if omitted. |
| `selections` | object | no | Product variant selections, e.g. `{"Color":"Red","Size":"10"}`. Use values from `/api/query` response. |

**200 OK (Firecrawl or scrape discovery):**
```json
{
  "order_id": "bloon_ord_9x2k4m",
  "product": {
    "name": "Anker 5-in-1 USB-C Hub",
    "url": "https://amazon.com/dp/B08EXAMPLE",
    "source": "amazon.com"
  },
  "payment": {
    "item_price": "17.99",
    "tax": "1.49",
    "shipping_cost": "0.00",
    "subtotal": "19.48",
    "fee": "0.39",
    "fee_rate": "2%",
    "total": "19.87",
    "discovery_method": "scrape"
  },
  "status": "awaiting_confirmation",
  "expires_in": 300
}
```

**200 OK (full cart discovery):**

Returned when scrape can't determine shipping cost. Browserbase session adds item to cart, fills shipping info, and extracts the full breakdown from the order review page.

```json
{
  "order_id": "bloon_ord_8k4n2p",
  "product": {
    "name": "Sony WH-1000XM5 Headphones",
    "url": "https://target.com/p/sony-headphones/...",
    "source": "target.com"
  },
  "payment": {
    "item_price": "22.99",
    "tax": "1.90",
    "shipping_cost": "0.00",
    "subtotal": "24.89",
    "fee": "0.50",
    "fee_rate": "2%",
    "total": "25.39",
    "discovery_method": "browserbase_cart"
  },
  "status": "awaiting_confirmation",
  "expires_in": 300
}
```

**400:** `SHIPPING_REQUIRED`, `URL_UNREACHABLE`
**502:** `PRICE_EXTRACTION_FAILED`

### Price Discovery Flow

The quote always returns the **full price** the agent will pay (item + tax + shipping + fee):

1. **Tier 1 (Firecrawl)** — Firecrawl `/extract` pulls structured product data including variant options and per-variant pricing. Fast (~5-10s). Requires `FIRECRAWL_API_KEY`. Falls through to Tier 2 if key not set or extraction fails. See `plans/16-firecrawl-discovery.md` for details.
2. **Tier 2 (scrape)** — Server-side HTTP fetch + JSON-LD / meta tag parsing. Free, fast (~1-2s). Falls through to Tier 3 if bot-blocked or no structured data.
3. **Tier 3 (Browserbase)** — Headless Chrome + Stagehand LLM agent extracts product info and variant prices. Slow (~30-120s) but handles anti-bot sites. Last resort.

The `discovery_method` field indicates which tier was used: `"firecrawl"`, `"scrape"`, or `"browserbase"`.

---

## POST /api/confirm

Execute a purchase. Runs browser checkout with the operator's credit card and returns a receipt.

```bash
curl -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{ "order_id": "bloon_ord_9x2k4m" }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | string | yes | Order ID from /api/buy |

**200 OK (completed):**
```json
{
  "order_id": "bloon_ord_9x2k4m",
  "status": "completed",
  "receipt": {
    "product": "Anker 5-in-1 USB-C Hub",
    "merchant": "amazon.com",
    "price": "17.99",
    "fee": "0.36",
    "total_paid": "18.35",
    "order_number": "112-4567890-1234567",
    "estimated_delivery": "Feb 21, 2026",
    "confirmation_email": "sent to jane@example.com",
    "browserbase_session_id": "sess_xyz",
    "timestamp": "2026-02-19T14:35:00Z"
  }
}
```

**500 (failed):**
```json
{
  "order_id": "bloon_ord_9x2k4m",
  "status": "failed",
  "error": {
    "code": "CHECKOUT_FAILED",
    "message": "Could not complete checkout: item out of stock"
  }
}
```

**404:** `ORDER_NOT_FOUND` | **410:** `ORDER_EXPIRED`

---

## Error Format

All errors:
```json
{ "error": { "code": "ERROR_CODE", "message": "...", "details": {} } }
```

| Code | HTTP | Meaning |
|------|------|---------|
| `SHIPPING_REQUIRED` | 400 | Physical product, no address |
| `URL_UNREACHABLE` | 400 | Can't reach URL |
| `INVALID_URL` | 400 | Not a valid HTTP(S) URL |
| `MISSING_FIELD` | 400 | Required field missing from request |
| `INVALID_SELECTION` | 400 | Selections must be non-empty string key-value pairs |
| `ORDER_NOT_FOUND` | 404 | Bad order_id |
| `ORDER_INVALID_STATUS` | 400 | Order cannot be confirmed in its current status |
| `ORDER_EXPIRED` | 410 | Quote > 5 min old |
| `CHECKOUT_FAILED` | 502 | Browser checkout failed |
| `PRICE_EXTRACTION_FAILED` | 502 | Could not extract price from page |
| `QUERY_FAILED` | 502 | Product discovery pipeline failed |
| `SEARCH_NO_RESULTS` | 404 | NL search returned 0 results |
| `SEARCH_UNAVAILABLE` | 503 | EXA_API_KEY not set, or Exa error |
| `SEARCH_RATE_LIMITED` | 429 | Exa rate limit hit |
| `PRICE_MISMATCH` | 409 | Cart total at checkout differs from quote |
