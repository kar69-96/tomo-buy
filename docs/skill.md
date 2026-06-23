---
name: bloon
version: 2.0.0
description: Purchase anything on the internet via browser checkout. Any URL. No API keys. No registration.
metadata: {"category":"commerce","interface":"rest","auth":"none"}
---

# BLOON API QUICK REFERENCE v2.0.0

**Base:** `http://localhost:3000`
**Auth:** None. Single operator mode.
**Docs:** This file is canonical.

## Endpoints:

- `POST /api/query` — discover product options and required fields
- `POST /api/buy` — get purchase quote for any URL
- `POST /api/confirm` — execute purchase, get receipt

## Rules:

- Recommended flow: query -> buy -> confirm (query discovers requirements, buy quotes, confirm executes)
- Physical products need a shipping address -- pass it in buy or server will ask
- Use query to discover product options (size, color) and required fields before buying
- 2% flat fee on all purchases
- All purchases execute via browser checkout with stored credit card

---

# Bloon API -- Agent Skills Guide

No API keys. No registration. No auth headers. Just HTTP requests.

## Quick Start

### 1. Discover a product
```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"url":"https://amazon.com/dp/B08EXAMPLE"}'
```

Response: product info, available options (size, color), and required fields for purchase.

### 2. Get a purchase quote
```bash
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://amazon.com/dp/B08EXAMPLE",
    "shipping":{
      "name":"Jane Doe",
      "street":"123 Main St",
      "city":"Austin","state":"TX","zip":"78701","country":"US",
      "email":"jane@example.com","phone":"512-555-0100"
    }
  }'
```

Returns a quote with price, fee, total. Does NOT charge anything yet.

### 3. Confirm the purchase
```bash
curl -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{"order_id":"bloon_ord_9x2k4m"}'
```

Executes browser checkout, returns receipt.

## Endpoint Details

### POST /api/query

Two modes -- send one field, not both:

| Body Field | Type | One-of | Description |
|------------|------|--------|-------------|
| `url` | string | yes | Product URL |
| `query` | string | yes | Natural language product search |

**URL mode** returns a single product:
```json
{
  "product": { "name": "...", "url": "...", "price": "...", "source": "...", ... },
  "options": [{ "name": "Size", "values": ["S", "M", "L"] }],
  "required_fields": [{ "field": "shipping.name", "label": "Full name" }, ...],
  "discovery_method": "firecrawl"
}
```

**NL search mode** returns up to 5 ranked products:
```json
{
  "type": "search",
  "query": "towels on amazon under $15",
  "products": [
    {
      "product": { "name": "...", "url": "...", "price": "12.99", "source": "amazon.com" },
      "options": [...],
      "required_fields": [...],
      "discovery_method": "exa_search",
      "relevance_score": 0.94
    }
  ],
  "search_metadata": { "total_found": 5, "domain_filter": ["amazon.com"], "price_filter": { "max": 15 } }
}
```

Usage notes:
- `options` lists product variants with per-variant prices where available
- `required_fields` tells you what shipping fields and selections to include in `/api/buy`
- If `selections` appears in `required_fields`, pass matching `{"Color":"White","Size":"M"}` in buy
- `discovery_method` is one of: `"firecrawl"`, `"exa"`, `"scrape"`, `"browserbase"`, `"exa_search"`
- NL queries support domain filters (`on amazon`), price filters (`under $15`), and ranges (`$10-$20`)
- NL search errors: `SEARCH_NO_RESULTS` (404), `SEARCH_UNAVAILABLE` (503), `SEARCH_RATE_LIMITED` (429)

### POST /api/buy

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `url` | string | yes | Product URL |
| `shipping` | object | no | Shipping address (required for physical products) |
| `selections` | object | no | Product options e.g. `{"Color":"Red","Size":"10"}` |

Returns:
```json
{
  "order_id": "bloon_ord_...",
  "product": { "name": "...", "url": "...", "price": "..." },
  "payment": {
    "item_price": "12.99",
    "fee": "0.26",
    "fee_rate": "0.02",
    "total": "13.25",
    "discovery_method": "firecrawl"
  },
  "status": "quoted",
  "expires_in": 300
}
```

Shipping rules:
- Provided -> use it
- Omitted + .env defaults -> use defaults
- Omitted + no defaults + physical product -> returns SHIPPING_REQUIRED

### POST /api/confirm

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `order_id` | string | yes | Order ID from /api/buy |

Returns:
```json
{
  "order_id": "bloon_ord_...",
  "status": "completed",
  "receipt": {
    "product": "...",
    "merchant": "...",
    "price": "12.99",
    "fee": "0.26",
    "total_paid": "13.25",
    "timestamp": "2026-03-19T...",
    "order_number": "114-...",
    "browserbase_session_id": "sess_..."
  }
}
```

Receipt always includes: product, merchant, price, fee, total_paid, timestamp.
May also include: order_number, browserbase_session_id.

## Recommended Agent Workflow

### When you have a specific URL
```
1. POST /api/query { url }
   -> Discover product options, required fields
2. POST /api/buy { url, shipping, selections? }
   -> Include all required_fields from query response
3. Present quote to human, get approval
4. POST /api/confirm { order_id }
5. Return receipt to human
```

### When the human describes what they want (NL search)
```
1. POST /api/query { query: "towels on amazon under $15" }
   -> Returns up to 5 ranked products
   -> Show human the options, let them pick one
2. POST /api/buy { url: products[chosen].product.url, shipping, selections? }
3. Present quote to human, get approval
4. POST /api/confirm { order_id }
5. Return receipt to human
```

## Error Codes

| Code | HTTP | What to Do |
|------|------|-----------|
| `SHIPPING_REQUIRED` | 400 | Ask human for address, retry buy |
| `ORDER_NOT_FOUND` | 404 | Bad order_id |
| `ORDER_EXPIRED` | 410 | Quote > 5 min, call buy again |
| `URL_UNREACHABLE` | 400 | Check URL |
| `CHECKOUT_FAILED` | 502 | Site issue, see error message |
| `CHECKOUT_DECLINED` | 502 | Payment declined by merchant |
| `PRICE_EXTRACTION_FAILED` | 502 | Could not extract price from page |
| `INVALID_SELECTION` | 400 | Bad selections format, check values |
| `INVALID_URL` | 400 | Not a valid HTTP(S) URL |
| `MISSING_FIELD` | 400 | Required field missing from request |
| `ORDER_INVALID_STATUS` | 400 | Order can't be confirmed (wrong status) |
| `QUERY_FAILED` | 502 | Product discovery failed, try different URL |
| `SEARCH_NO_RESULTS` | 404 | NL search found nothing, broaden query |
| `SEARCH_UNAVAILABLE` | 503 | Search service not configured (check EXA_API_KEY) |
| `SEARCH_RATE_LIMITED` | 429 | Search rate limited, retry in a moment |

## What the Agent Never Sees

- Credit card numbers (placeholder system -- card fields filled via Playwright CDP, never through the LLM)

## What the Agent Always Sees

- Product name, URL, price
- Fee amount and rate
- Receipt with confirmation details (order number, merchant, totals)

---

Any URL. Browser checkout. Receipt back.
