# Bloon HTTP Checkout Engine — System Specification

**Author:** Karthik
**Status:** Architecture reviewed — ready for implementation
**Last updated:** 2026-03-19
**Review:** Engineering review completed 2026-03-19 (10 decisions, 3 critical gaps addressed)

> This document defines the architecture for Bloon's HTTP checkout engine — an **additive** optimization layer that runs alongside the existing Stagehand browser engine. The HTTP engine learns checkout flows on first contact and replays them as pure HTTP on subsequent runs. The Stagehand engine is preserved as a parallel path for A/B testing.
>
> Design priorities: reliability over speed on first run, speed over everything on cached runs, zero LLM calls on the hot path.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                            │
│                                                             │
│  confirm() called                                           │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────┐                                        │
│  │ Engine Selector  │── engine=http ──→ HTTP Engine          │
│  │ (A/B routing)   │                     │                  │
│  └────────┬────────┘                     │ failure/stale?   │
│           │                              ▼                  │
│           │ engine=stagehand    ┌────────────────┐          │
│           ▼                    │ Invalidate      │          │
│  ┌────────────────┐            │ cache, fall     │          │
│  │ runCheckout()  │◀───────────│ back to         │          │
│  │ (existing      │            │ Stagehand       │          │
│  │  Stagehand)    │            └────────────────┘          │
│  └────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘

Both engines coexist. Only one runs per checkout.
Selection is via a routing flag — defaults can be
domain-level (site profile stores http_eligible).
```

---

## What It Does

Takes a product URL, user details (shipping address, card, email/password), and produces a completed order. First time on a new domain, it walks the checkout funnel via HTTP (with browser fallback for SPA pages), learning every endpoint and payload format. Every time after, it replays the flow as pure HTTP — no browser, no LLM.

---

## Components

### Session Manager

Holds cookies, auth tokens, CSRF tokens, and any server-generated IDs for a single checkout flow. **Per-flow isolation** — each `runHTTPCheckout()` call creates its own `SessionManager` instance with a fresh cookie jar. No shared mutable state between concurrent flows.

When the browser renderer sets a cookie, the session manager captures it. When the HTTP client needs to make a request, the session manager injects the right cookies and headers.

> **Design decision:** Per-flow isolation prevents cart contamination, CSRF token races, and auth state bleed between concurrent checkouts on the same domain.

### Page Fetcher

Makes HTTP GET requests to pages. Uses multi-signal scoring to determine whether the response is server-rendered or an SPA shell (see SPA Detection below). If server-rendered, passes the HTML to the page parser. If SPA shell, hands off to the browser renderer.

#### SPA Detection — Multi-Signal Scoring

The page fetcher scores 8+ signals instead of using a simple text-length threshold. Score >= 3 means server-rendered (use HTTP); score < 3 means browser rendering needed.

```
SIGNAL                              | WEIGHT | CHECK
────────────────────────────────────┼────────┼──────────────────────
JSON-LD structured data present     | +3     | <script type="application/ld+json">
Open Graph price meta tags          | +2     | <meta property="og:price:amount">
Form with action + method           | +3     | <form action="..." method="POST">
Hidden inputs (CSRF/tokens)         | +2     | <input type="hidden" name="*token*">
JS framework markers present        | -2     | __NEXT_DATA__, __NUXT__, data-reactroot
Empty SPA mount point               | -3     | #app/#root/#__next with no/minimal children
Skeleton/shimmer loading classes    | -2     | class*="skeleton", class*="shimmer"
Visible text < 100 chars            | -3     | Minimal rendered content
Visible text > 500 chars            | +1     | Substantial content exists
<noscript> has real content         | +1     | Site provides non-JS fallback
```

> **Why not text-length alone:** Server-rendered skeleton UI (loading spinners, placeholder boxes) has plenty of HTML characters but no real data. Next.js pages server-render content but need JS hydration for interactive elements. The multi-signal approach catches both cases.

### Browser Renderer

Reuses the existing Browserbase + Stagehand infrastructure from `packages/checkout/src/session.ts`. Only invoked when the page fetcher's SPA score is below threshold. Loads the page, waits for DOM to stabilize, extracts the rendered HTML, pulls cookies into the session manager. **Read-only** — never clicks, types, or submits.

> **Design decision:** Reuses `createSession()` + Stagehand init from the existing checkout package rather than building a separate Playwright integration. One browser lifecycle, two usage patterns.

### Page Parser

Takes HTML (from HTTP response or browser renderer) and produces a structured snapshot using cheerio. Extracts:
- Every form with its action, method, and fields
- Every hidden input (CSRF tokens, product IDs)
- Inline config objects (JSON in `<script>` tags, `__NEXT_DATA__`)
- Links and buttons with their labels
- Meta tags with tokens
- Stripe publishable keys (`pk_live_*`, `pk_test_*`)
- Script source URLs

### Page Classifier

Takes the structured snapshot and determines which funnel stage the page represents. Uses signal constants shared with the Stagehand engine's `detectPageType()` (from `@bloon/core/classification-signals`).

Rule-based first, LLM fallback for low-confidence cases. Classification signals (text patterns, URL patterns, field selectors) live in `packages/core/src/classification-signals.ts` — shared between both engines.

> **Design decision:** Shared signal constants prevent DRY violations. Each engine implements its own classifier against its DOM model (Playwright for Stagehand, cheerio for HTTP).

### Site Profile Cache

JSON file storage keyed by domain (in `~/.bloon/profiles/`). Stores the complete `SiteProfile` — see type definition in `packages/core/src/site-profile.ts`. Read before every purchase. Written after every successful first run.

### Flow Executor

Takes a `SiteProfile` and user inputs. Fires HTTP requests in sequence, extracting dynamic values from previous responses using the `ValueSource` schema and injecting them into subsequent requests. Handles Stripe tokenization directly. Reports success or failure with the specific step that failed.

**Critical guards:**
- Validates all extracted dynamic values are non-null before firing the next request. Aborts the step (instead of injecting `undefined` into URLs) if extraction fails.
- Max 5 redirects per step. Exceeding = stale profile, triggers re-learn.
- Stripe API errors (invalid pk_, rate limits) treated as staleness signals.

### Orchestrator

Coordinates the HTTP engine. Decides strategy based on site profile cache state:
- **Cache hit + http_eligible:** Flow Executor (cached path)
- **Cache hit + not http_eligible:** Route to Stagehand engine
- **Cache miss:** First-run analysis (HTTP walker)
- **Cached run failure:** Invalidate profile, can retry via Stagehand

---

## Phase 1: Receive the Request

The orchestrator receives a product URL and user details. Extracts the domain and checks the site profile cache.

- **Cache hit, http_eligible:** Skip to Phase 5 (cached execution).
- **Cache hit, not http_eligible:** Route to Stagehand engine (bot-protected domain).
- **Cache miss:** Proceed to Phase 2 (first-run analysis).

---

## Phase 2: Analyze the Product Page

The page fetcher GETs the product URL with full browser-like headers, using the session manager to store any cookies.

The page fetcher runs multi-signal SPA scoring on the response. Score >= 3 → pass HTML to page parser. Score < 3 → hand off to browser renderer, then pass rendered HTML to page parser.

The page parser produces the product page snapshot. The page classifier confirms this is a product page. The orchestrator now has:

- The add-to-cart mechanism (form action and fields, or API endpoint from inline config)
- Product details (name, price, variants, SKUs)
- Any site-wide tokens (CSRF, session config)
- The platform identity (Shopify, WooCommerce, BigCommerce, Magento, or unknown)
- The Stripe publishable key (if visible)
- Bot protection level (based on response headers: Cloudflare, PerimeterX, DataDome signatures)

If the platform is identified as Shopify, WooCommerce, BigCommerce, or Magento, the orchestrator loads a platform template with strong expectations about the flow structure. Still proceeds through the funnel to validate.

---

## Phase 3: Walk the Funnel

The orchestrator progresses stage by stage. At each stage: fetch page (HTTP first, browser fallback), classify it, execute the required action. **Every HTTP request and response is recorded** — URL, method, headers, payload, response status, response body structure, redirects, Set-Cookie headers — for building the cached profile.

### Stage: Add to Cart

Programmatic. POST to the add-to-cart endpoint. Include product ID, selected variant, quantity, session cookies, CSRF token.

Success: response contains cart ID, updated cart, or redirect to cart. Extract cart ID via the extraction schema.

Failure: wrong endpoint format, out of stock, missing token. **Browser fallback:** have the browser renderer click the actual button while intercepting the network request. The intercepted request reveals the correct endpoint and payload.

### Stage: Cart Review

Programmatic. GET the cart page URL. Classify the response — should be a cart page with line items and a proceed-to-checkout action. Extract the checkout URL.

### Stage: Authentication Gate

The classifier examines the page. Priority order:

1. **Guest checkout:** email-only field, "continue as guest" link/button. POST email to guest endpoint.
2. **Login:** POST credentials. Capture session cookie/JWT on success.
3. **Register:** POST registration. Handle email verification if required (poll inbox via AgentMail).

Store the auth flow type and endpoint details in the profile.

### Stage: Shipping

Map user address data to the site's field names. The LLM handles non-obvious mappings (e.g., `administrative_area` → `state`). POST the address. Extract shipping rates from the response. Select cheapest (or user-specified). POST the selected rate ID.

### Stage: Payment

The orchestrator checks which payment processor is present.

#### Stripe — Dual-Path Detection

Scan the page HTML and inline scripts:

1. **Scan for `client_secret` / `pi_*_secret_*` pattern** → Client-side confirmation detected
2. **Scan for `pk_live_*` / `pk_test_*` without client secret** → Server-side confirmation detected
3. **Check form action** → If form POSTs to merchant endpoint (not `api.stripe.com`) → Server-side

**Client-side confirmation flow:**
```
POST api.stripe.com/v1/payment_methods  (with pk_ + card details)
  → pm_xxx
stripe.confirmCardPayment(client_secret, {paymentMethod: pm_xxx})
  → Stripe confirms → merchant webhook
```

**Server-side confirmation flow (simpler):**
```
POST api.stripe.com/v1/payment_methods  (with pk_ + card details)
  → pm_xxx
POST merchant's payment endpoint with pm_xxx
  → Merchant calls stripe.paymentIntents.confirm() server-side
  → Response = order confirmation
```

> **Design decision:** Server-side confirmation is increasingly common and actually simpler — we never need the client_secret. Explicit dual-path with auto-detection, stored in site profile.

**Other processors:**
- **Braintree:** GET client token → create payment nonce → POST nonce to merchant.
- **Native payment:** POST card details to merchant's endpoint.
- **Unknown/complex:** Browser fallback. Intercept network requests for future caching.

### Stage: Order Confirmation

After payment: extract order ID, total, confirmation number from the response. This is the success signal.

---

## Phase 4: Cache the Site Profile

After a successful first run, write the complete `SiteProfile` to cache. See `packages/core/src/site-profile.ts` for the full TypeScript interface.

**What gets stored:**

- Domain, platform type, bot protection level, http_eligible flag
- Ordered endpoint chain with `EndpointStep[]` — each step has:
  - URL pattern with `{placeholder}` tokens for dynamic segments
  - HTTP method, content type, required headers
  - Payload template with `PayloadField[]` (field name + value source)
  - `DynamicValue[]` extractions — how to pull values from this step's response
  - `ResponseFingerprint` for staleness detection
  - Expected redirect chain (domains in order)
- Auth flow type and step index
- Stripe integration details (confirmation type, pk_, client secret source)
- Token locations (meta tag, cookie, header, hidden input — per-session vs per-request)
- Field name mappings (site field → standard field)
- Page classification results per URL
- Interstitial handling (cookie consent, age verification — dismiss selectors)
- Staleness metadata (TTL, invalidation count, last validated timestamp)

### Dynamic Value Extraction Schema

Each `DynamicValue` defines how to extract a runtime value from a previous step's response:

```typescript
interface ValueSource {
  type: "json_path" | "css_selector" | "regex" | "set_cookie" | "response_header" | "url_segment";
  path: string;       // JSONPath, CSS selector, regex, cookie name, header name, or URL regex
  attribute?: string;  // For css_selector: which attribute (default: textContent)
  group?: number;      // For regex/url_segment: capture group (default: 1)
}

interface DynamicValue {
  name: string;        // Placeholder name (e.g., "checkout_session_id")
  sourceStep: number;  // Which step's response to extract from (0-indexed)
  extraction: ValueSource;
}
```

**Example:** Shopify checkout session ID extraction:
```
Step 2: POST /checkout → response redirects to /checkout/cn_abc123/shipping
DynamicValue: {
  name: "checkout_session_id",
  sourceStep: 2,
  extraction: { type: "url_segment", path: "/checkout/([^/]+)", group: 1 }
}
Step 3: POST /checkout/{checkout_session_id}/shipping
```

---

## Phase 5: Cached Execution

A purchase request comes in for a cached, http_eligible domain. The orchestrator loads the profile and hands it to the flow executor.

The flow executor:

1. Creates a fresh per-flow `SessionManager` (new cookie jar)
2. GETs the homepage or product page to establish cookies and grab a fresh CSRF token
3. Fires the endpoint chain in order:

```
1. POST add to cart. Capture cart_id.
2. POST login or guest checkout. Capture auth_token.
3. POST create checkout session. Capture session_id + Stripe client_secret.
4. POST shipping address.
5. GET shipping rates. Select rate.
6. POST selected shipping rate.
7. POST card to Stripe api.stripe.com/v1/payment_methods. Get pm_xxx.
8. Confirm payment (client-side: confirmCardPayment; server-side: POST pm_ to merchant).
9. POST complete order. Capture order_id.
```

**Per-step validation:**
- Validate all extracted dynamic values are **non-null** before constructing the next request
- Follow redirects manually (don't auto-follow) — compare redirect chain to cached expectation
- Compare response fingerprint (Jaccard similarity of field names/keys >= 0.7)
- If any validation fails → mark profile as stale → invalidate → fall back to first-run analysis

**Total time for cached execution: ~2-3 seconds.** No browser, no rendering, no LLM. Stripe API calls (~800ms + ~500ms) dominate the latency.

> **Design decision:** The cached path is the entire point. First-run analysis is expensive (~30-60 seconds). But it only happens once per domain. Cached runs at near-zero marginal cost make the 2% fee viable at scale.

---

## Staleness Detection — Three Layers

### Layer 1: Redirect Chain Validation (per-request, cheap)

For each request in the endpoint chain:
- Follow redirects manually (don't auto-follow with fetch)
- If final URL domain differs from cached URL domain → **STALE**
- If redirect count differs from cached → **STALE**
- Each `EndpointStep` stores `expectedRedirectChain`

### Layer 2: Response Structure Fingerprint (per-step, medium cost)

For each endpoint response, store a structural fingerprint:
- For HTML: set of form field names + form action paths
- For JSON: set of top-level keys + nested key paths
- For redirects: Location header pattern

Compare fingerprint on cached run:
- Jaccard similarity < 0.7 → **STALE**
- Each `EndpointStep` stores `ResponseFingerprint`

### Layer 3: Adaptive TTL (background, zero per-request cost)

- Base TTL: 7 days (configurable per-domain)
- After each successful cached run: refresh TTL
- After each staleness-triggered invalidation: **halve** TTL for that domain (min 1 day)
- Sites that change often auto-tune to shorter TTLs
- Stored in `StalenessMetadata` on the profile

---

## Bot Detection & Routing

The site profile stores `bot_protection_level`:

- **`none`** — Pure HTTP (fetch). Zero browser cost. Most small/medium stores.
- **`stealth`** — Route requests through Browserbase stealth adapter (port 3003). Real browser fingerprint + proxy. No LLM cost, only session cost.
- **`full_browser`** — Route to existing Stagehand engine. Required for sites with aggressive JS challenges.

Detection happens during first-run analysis based on:
- Response headers: `cf-ray` (Cloudflare), `x-px` (PerimeterX), `x-datadome` (DataDome)
- Challenge pages: HTML contains Turnstile/reCAPTCHA/hCaptcha widgets
- 403/challenge responses to plain HTTP requests

> **Design decision:** Don't fight bot detection — route around it. The HTTP engine is an optimization for the long tail of unprotected stores. Protected domains use stealth or full browser.

---

## Error Handling

### Session expiration mid-flow (401/403)

**Restart the entire flow from step 1** (add to cart). Do NOT attempt to resume from the failed step — server-side session state (cart, checkout session) is likely invalidated. The cost is a few extra HTTP requests. The benefit is correctness.

### CSRF token expiration

POST returns a token mismatch error. Re-fetch the page containing the token, extract a fresh one, retry the failed request.

### Null dynamic value extraction

A `ValueSource` extraction returns null (response structure changed but fingerprint check passed). **Abort immediately** — do not fire the next request with `undefined` in the URL or payload. Mark the profile as stale and trigger re-learn.

### Stripe API errors

Invalid publishable key (`pk_` rotated), rate limit (429), or authentication failure. Treat as a **staleness signal** — the profile's Stripe configuration is outdated. Invalidate and re-learn.

### Redirect loops

Max 5 redirects per step (configurable via `maxRedirects` on `EndpointStep`). If exceeded, treat as stale profile. Without this limit, a restructured checkout flow could cause infinite A→B→A→B loops.

### Out of stock

Add-to-cart or checkout returns an inventory error. Abort and report. Nothing to retry.

### Payment declined

Stripe or merchant returns a decline. Report the reason (insufficient funds, incorrect CVC, fraud block). Don't retry — card issue needs human resolution.

### Unexpected page during first run

The classifier returns `UNKNOWN`. Look for a single obvious action (accept/continue/dismiss). If found, take it and reclassify. If not, use LLM to interpret. If LLM can't determine an action, abort.

### Site has changed since cache was built

Any staleness signal (Layer 1, 2, or 3) → invalidate the cache for this domain → restart as first-run analysis. Self-healing — the system automatically re-learns.

### Rate limiting (429)

Wait the Retry-After duration (or exponential backoff). Retry. If repeated 429s, add delays between steps.

---

## LLM Usage Boundary

**LLM is used for:**
- Page classification when the rule-based classifier is uncertain
- Form field semantic mapping (site's field names → standard names)
- Interpreting unknown/unexpected pages during first run
- Extracting endpoint information from complex inline JavaScript config objects

**LLM is NOT used for:**
- Cached execution (zero LLM calls on the hot path)
- Session management
- Cookie handling
- Stripe tokenization
- HTTP request construction and execution
- Platform detection (rule-based)
- Cache management
- SPA detection scoring

> **Design decision:** The LLM boundary is the most important architectural choice. By confining LLM usage to first-run analysis only, steady-state cost is purely infrastructure (HTTP requests + JSON file reads). This separates Bloon from browser-only automation tools that burn tokens on every checkout.

---

## Type Definitions

The core types for the HTTP engine live in `packages/core/src/`:

- **`site-profile.ts`** — `SiteProfile`, `EndpointStep`, `ValueSource`, `DynamicValue`, `ResponseFingerprint`, `TokenLocation`, `FieldMapping`, `StripeIntegration`, `StalenessMetadata`, and all related types
- **`classification-signals.ts`** — `PageType`, all signal arrays (confirmation, error, login, cart, shipping, donation, etc.), `SpaSignal` for multi-signal SPA scoring, card field selectors

These types are shared between both the HTTP engine and the existing Stagehand engine.

---

## Resolved Questions

**Bot detection on cached HTTP path:** Use Browserbase stealth mode + existing stealth adapter (port 3003) for protected domains. Site profile stores `bot_protection_level: "none" | "stealth" | "full_browser"`. Protected domains route to stealth or Stagehand. HTTP engine optimizes the long tail of unprotected stores.

**Profile cache sharing across instances:** Deferred. Per-instance for v1. Single operator mode — no consistency concerns. Revisit if multi-instance deployment becomes a requirement.

**Cache TTL:** Adaptive decay. Base 7 days. After successful cached run, refresh TTL. After staleness-triggered invalidation, halve TTL (min 1 day). High-frequency domains (Amazon, Walmart) auto-tune to shorter intervals through natural invalidation cycles.
