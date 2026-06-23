# Bloon — Logging & Monitoring Reference

All observability in Bloon is custom-built. There are no third-party logging libraries (no winston, pino, sentry, datadog, etc.). Monitoring relies on `console.log`/`console.error`, the `CostTracker` class, `StepTracker`, and Browserbase session replay URLs.

---

## 1. Cost Tracking (`CostTracker`)

The primary monitoring mechanism. Tracks LLM token usage and Browserbase session durations, computes estimated USD costs, and prints a formatted table at the end of each run.

### Class Definition

**File:** `packages/checkout/src/cost-tracker.ts`

**Types:** `CostEntry`, `SessionCostEntry`, `CostBreakdown` in `packages/core/src/types.ts`

### Pricing

| Model | Input $/1M tokens | Output $/1M tokens |
|-------|--------------------|--------------------|
| `google/gemini-2.5-flash` | $0.15 | $0.60 |
| `google/gemini-2.0-flash` | $0.10 | $0.40 |
| Browserbase (Dev plan) | $0.12/hr | — |

### Methods

- `addLLMCall(label, inputTokens, outputTokens, model, durationMs)` — record one LLM invocation
- `addSession(sessionId, durationMs)` — record one Browserbase session
- `getSummary(): CostBreakdown` — structured cost data
- `printSummary()` — prints ASCII table to console

### Output Format

```
┌─────────────────────────────────────────────────────────┐
│              BLOON RUN COST BREAKDOWN                   │
├───────────────────────┬──────────┬──────────┬───────────┤
│ Operation             │ In Tokens│Out Tokens│ Est. $    │
├───────────────────────┼──────────┼──────────┼───────────┤
│ checkout/step-1       │    1,200 │      340 │   $0.0004 │
│ checkout/step-2       │    1,800 │      520 │   $0.0006 │
│ LLM TOTAL             │   42,000 │   12,000 │   $0.0130 │
├───────────────────────┼──────────┴──────────┼───────────┤
│ Browserbase           │            4m 12s   │   $0.0084 │
├───────────────────────┼─────────────────────┼───────────┤
│ TOTAL EST.            │                     │   $0.0214 │
└───────────────────────┴─────────────────────┴───────────┘
```

### Where CostTracker is Instantiated

| File | Function | Tracker variable | Scope |
|------|----------|-----------------|-------|
| `packages/checkout/src/task.ts` | `runCheckout()` | `costTracker` | Full checkout flow (agent steps + session) |
| `packages/checkout/src/discover.ts` | `discoverViaBrowser()` | `discoverTracker` | Browser product discovery |
| `packages/checkout/src/discover.ts` | `fetchVariantPriceBrowser()` | `variantTracker` | Single variant price fetch |
| `packages/checkout/src/discover.ts` | `discoverViaCart()` | `cartTracker` | Cart-based price discovery |

### All Tracked Operations

| File | Operation Label | What it Tracks |
|------|----------------|---------------|
| `task.ts` | `checkout/step-N` | Per-step LLM tokens from `onStepFinish` callback |
| `task.ts` | `checkout/agent-total` | Aggregate agent result tokens |
| `task.ts` | Session tracking | Browserbase session duration for checkout |
| `agent-tools.ts` | `act/{instruction}` | `stagehand.act()` duration in `actWithRetry` |
| `agent-tools.ts` | `observe/card-fields` | `stagehand.observe()` for finding card input fields |
| `agent-tools.ts` | `observe/click-{target}` | `stagehand.observe()` fallback in clickButton tool |
| `discover.ts` | `discover/extract` | `stagehand.extract()` in `discoverViaBrowser` |
| `discover.ts` | `variant/{value}` | Agent tokens for per-variant price resolution |
| `discover.ts` | `cart/add-to-cart` | `stagehand.act("Add this product to cart")` |
| `discover.ts` | `cart/go-to-checkout` | `stagehand.act("Go to cart or proceed to checkout")` |
| `discover.ts` | `cart/fill-shipping` | `stagehand.act()` for shipping form fill |
| `discover.ts` | `cart/extract-pricing` | `stagehand.extract()` for cart pricing |

### API Surface

`CostBreakdown` is returned in `CheckoutResult.costBreakdown` (optional), which flows through the orchestrator to the API response on `/api/confirm`.

---

## 2. Console Logging

| File | Line | Level | What it Logs |
|------|------|-------|-------------|
| `packages/api/src/index.ts` | 9 | `log` | Server startup: `Bloon listening on http://localhost:{port}` |
| `packages/api/src/error-handler.ts` | 29 | `error` | Non-BloonError exceptions: `Unhandled error: {err}` |
| `packages/checkout/src/cost-tracker.ts` | 112 | `log` | Cost breakdown ASCII table (from `printSummary()`) |

---

## 3. Step Tracking (`StepTracker`)

**File:** `packages/checkout/src/step-tracker.ts`

Tracks the current checkout step for diagnostic/error reporting. Not a logging tool per se, but provides step-level progress tracking.

### Checkout Steps

All 13 steps defined in `CHECKOUT_STEPS` (`task.ts`):

| Step | Description |
|------|-------------|
| `navigate` | Initial page load |
| `add-to-cart` | Adding product to cart |
| `proceed-to-checkout` | Navigating to checkout |
| `dismiss-popups` | Clearing overlays/modals |
| `fill-shipping` | Filling shipping/contact form |
| `select-shipping` | Choosing shipping method |
| `avoid-express-pay` | Declining Google Pay, Apple Pay, etc. |
| `observe-card-fields` | Finding card input elements |
| `fill-card` | Filling card payment fields |
| `fill-billing` | Filling billing address |
| `verify-price` | Checking price matches expected |
| `place-order` | Clicking final submit button |
| `verify-confirmation` | Checking confirmation page |

### How Steps are Inferred

`StepTracker.update(toolCalls, pageUrl)` inspects tool names and URL patterns:
- Tool `fillShippingInfo` → `fill-shipping`
- Tool `fillCardFields` → `fill-card`
- Tool `fillBillingAddress` → `fill-billing`
- URL contains `/cart` → `proceed-to-checkout`
- URL contains `/checkout` or `/payment` → `proceed-to-checkout`
- URL contains `/confirmation` or `/thank` → `verify-confirmation`

### API Surface

`CheckoutResult.failedStep` contains the step where checkout failed, surfaced in the API confirm response and stored on the order.

---

## 4. Browserbase Session Replay

Every Browserbase session generates a replay URL for visual debugging of the browser automation.

| File | What | Description |
|------|------|-------------|
| `packages/checkout/src/session.ts:89` | `replayUrl` construction | `https://browserbase.com/sessions/${id}` |
| `packages/checkout/src/task.ts` (all returns) | `replayUrl` on `CheckoutResult` | Always included, success or failure |
| `packages/orchestrator/src/receipts.ts:32` | `browserbase_session_id` on `Receipt` | Permanent reference for completed orders |
| `packages/core/src/types.ts:75` | `Receipt.browserbase_session_id` | Exposed to API callers in confirm response |

---

## 5. Stagehand Built-in Logging

Stagehand emits its own `[INFO]` and `[ERROR]` lines via its internal logger. The Bloon code does **not** configure a custom `logger:` option on Stagehand, so its default console-based logging is active. This includes:

- Session connection events (`Browserbase session started/resumed`)
- Agent tool calls (`Agent calling tool: act/ariaTree/done`)
- LLM response details (token counts, finish reason)
- Extraction progress and results
- Error details (schema validation failures, quota exceeded)

These logs are unstructured and cannot be programmatically queried. They are useful for real-time debugging during development.

---

## 6. What is NOT Logged

- No structured logging library (no JSON log format)
- No log levels beyond console.log/error
- No log aggregation or remote shipping
- No request/response logging on API endpoints
- No performance metrics (response times, p50/p95/p99)
- No rate limit tracking
- No wallet/transaction event logging
- No x402 payment event logging
- No domain cache hit/miss logging
- No OpenTelemetry / distributed tracing
