# Error Handling — Bloon v1

## Error Response Format

All API errors return JSON with a consistent structure:

```json
{
  "error": {
    "code": "CHECKOUT_FAILED",
    "message": "Browser checkout failed at payment step"
  }
}
```

HTTP status codes follow REST conventions.

---

## Error Matrix

| Code | HTTP | When | Agent Should |
|------|------|------|-------------|
| `SHIPPING_REQUIRED` | 400 | Physical product, no shipping provided | Ask human for address, retry buy |
| `ORDER_NOT_FOUND` | 404 | Invalid order_id | Check order_id, call buy again |
| `ORDER_EXPIRED` | 410 | Quote older than 5 minutes | Call buy again for fresh quote |
| `ORDER_INVALID_STATUS` | 400 | Order not in "awaiting_confirmation" status | Check order status, may need new buy |
| `URL_UNREACHABLE` | 400 | Cannot fetch the product URL | Check URL, retry |
| `PRICE_EXTRACTION_FAILED` | 502 | Browser couldn't extract price from page | Try different URL for same product |
| `CHECKOUT_FAILED` | 502 | Browser checkout failed | Retry or try different URL |
| `QUERY_FAILED` | 502 | Product discovery pipeline failed | Try different URL |
| `SEARCH_NO_RESULTS` | 404 | NL search returned 0 matching products | Broaden query or remove price/domain filter |
| `SEARCH_UNAVAILABLE` | 503 | EXA_API_KEY not set, or unexpected Exa error | Check env vars, retry |
| `SEARCH_RATE_LIMITED` | 429 | Exa API rate limit exceeded | Wait and retry |
| `MISSING_FIELD` | 400 | Required field not in request body | Check API docs, add missing field |
| `INVALID_URL` | 400 | URL is not a valid HTTP(S) URL | Fix URL format |
| `INVALID_SELECTION` | 400 | Selections must be non-empty string key-value pairs | Check selections format |
| `PRICE_MISMATCH` | 409 | Cart total at checkout differs from quote | Retry buy for fresh quote |

---

## Error Severity Levels

### Recoverable (agent can handle)
- `SHIPPING_REQUIRED` → ask human for address, retry
- `ORDER_EXPIRED` → call buy again
- `ORDER_INVALID_STATUS` → check order status
- `URL_UNREACHABLE` → retry or use different URL
- `MISSING_FIELD` → fix request, retry
- `INVALID_URL` → fix URL, retry
- `INVALID_SELECTION` → fix selections format, retry
- `SEARCH_NO_RESULTS` → broaden query, remove price/domain filter
- `SEARCH_RATE_LIMITED` → wait and retry
- `PRICE_MISMATCH` → retry buy for fresh quote

### Requires Human Attention
- `PRICE_EXTRACTION_FAILED` → site may be unsupported
- `QUERY_FAILED` → discovery pipeline failed, try different URL
- `CHECKOUT_FAILED` → browser checkout failed, may need investigation

---

## Failed Purchase Recovery

When `CHECKOUT_FAILED` occurs:

1. Order status set to `"failed"`
2. Error details preserved in order record
3. Agent should report the failure to the human
4. No funds are at risk since the credit card charge only completes on successful checkout

```json
{
  "order_id": "bloon_ord_9x2k4m",
  "status": "failed",
  "error": {
    "code": "CHECKOUT_FAILED",
    "message": "Browser checkout failed at payment step"
  }
}
```

---

## Validation Rules

### POST /api/query
- Either `url` or `query` is required (not both, not neither)
- `url` path: must be valid HTTP(S) URL
- `query` path: must be non-empty, ≥2 chars after trimming

### POST /api/buy
- `url` required, valid HTTP(S) URL
- `shipping` optional object — if provided, all required fields must be non-empty (name, street, city, state, zip, country, email, phone). `apartment` is optional.
- `shipping` falls back to .env defaults if omitted; returns `SHIPPING_REQUIRED` if no defaults
- `selections` optional object — if provided, all keys and values must be non-empty strings

### POST /api/confirm
- `order_id` required, must exist
- Order must be in `"awaiting_confirmation"` status
- Order must not be expired (< 5 min since created)

---

## Internal Error Handling

### Browserbase Session Cleanup
- Sessions destroyed after every checkout (success or failure)
- Session timeout: 5 minutes max
- On crash: orphaned sessions expire automatically

### Store Write Safety
- JSON writes use write-then-rename (atomic)
- Concurrent writes are serialized (single-process for v1)
- Store corruption: worst case, restart with fresh store

---

## v1 Limitations

1. **No automatic retry** — agent must explicitly retry failed operations
2. **No webhook notifications** — agent must poll for status updates
3. **Single error per response** — no batched error reporting
