# Computer Use — Browserbase + Stagehand (Phase 4)

Phase 4 is the largest and highest-risk phase. It builds `packages/checkout/` — the browser automation system that lets Bloon purchase physical products from any e-commerce site using a cloud browser controlled by an LLM.

**Stack**: Browserbase (cloud browser) + Stagehand (AI browser automation SDK, also by Browserbase) + Playwright (CDP credential fills).

---

## How It Works

```
POST /api/confirm { order_id }
  │
  ├─ Load order (product URL, shipping, quoted total)
  ├─ Transfer USDC: agent wallet → master wallet
  │
  ├─ Create fresh Browserbase session (cloud Chromium)
  ├─ Initialize Stagehand on the session
  ├─ Connect separate Playwright CDP for credential fills
  ├─ Inject domain cache (cookies/localStorage) if available
  │
  ├─ Run checkout orchestration (Claude Sonnet 4):
  │   1. stagehand.act("navigate to URL, add to cart, go to checkout")
  │   2. stagehand.observe("find the shipping form fields")
  │   3. stagehand.act("fill shipping name with %shipping_name%", { variables })
  │   4. For card fields → Playwright CDP fill (never through Stagehand LLM)
  │   5. stagehand.act("click Place Order")
  │   6. stagehand.extract("extract order confirmation number and total")
  │
  ├─ Verify confirmation page (text signal matching)
  ├─ Verify final total matches quote (±$1 or 5%)
  │
  ├─ Save domain cache for next time
  └─ Destroy Browserbase session
```

### Two Channels, One Session

Stagehand and Playwright share the same Browserbase session but serve different purposes:

| Channel | Purpose | Sees credentials? |
|---------|---------|-------------------|
| **Stagehand** | Navigation, clicking, observing, extracting | No — uses `%var%` placeholders for non-card fields, never sees card data |
| **Playwright CDP** | Filling card number, CVV, expiry | Yes — fills directly into DOM via CDP, bypasses all LLMs |

This is the same dual-channel pattern used in AgentPay's `StagehandProxy`.

---

## Components

```
packages/checkout/src/
├── task.ts              # 12-step checkout orchestration (Stagehand agent)
├── session.ts           # Browserbase session create/destroy + domain cache inject
├── credentials.ts       # .env → credential map, CDP vs Stagehand split
├── fill.ts              # Card field CDP fill (iframe-aware) + form field evaluation
├── agent-tools.ts       # Stagehand agent tools (fillShippingInfo, fillCardFields, fillBillingAddress)
├── discover.ts          # Price discovery tiers (scrape → cart → browser) + variant resolution
├── confirm.ts           # Confirmation page detection (text signal matching)
├── cache.ts             # Domain cookie/localStorage extract/inject
├── cost-tracker.ts      # LLM call + Browserbase session cost tracking
├── step-tracker.ts      # 13-step checkout progress tracking
├── concurrency-pool.ts  # Checkout-specific concurrency pool
└── index.ts             # Public exports
```

---

## Browserbase Sessions

### Creating a Session

Browserbase provides cloud Chromium instances accessible via CDP (Chrome DevTools Protocol). Use the REST API directly — no SDK needed.

```typescript
// session.ts
const response = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-bb-api-key": process.env.BROWSERBASE_API_KEY,
  },
  body: JSON.stringify({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    proxies: true,
    browserSettings: {
      solveCaptchas: true,
      recordSession: true,
      logSession: true,
    },
  }),
});

const session = await response.json();
// session.id       → "sess_abc123"
// session.connectUrl → "wss://connect.browserbase.com?sessionId=..."
```

Key settings:
- `proxies: true` — residential proxies for bot detection avoidance
- `solveCaptchas: true` — Browserbase auto-solves CAPTCHAs
- `recordSession: true` — enables session replay for debugging
- `logSession: true` — captures network/console logs

### Connecting Stagehand + Playwright CDP

Two connections to the same session:

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright-core";

// 1. Stagehand — for navigation, observation, extraction
const stagehand = new Stagehand({
  browserbaseSessionID: session.id,
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  modelName: "anthropic/claude-sonnet-4-20250514",
  modelApiKey: process.env.ANTHROPIC_API_KEY,
});
await stagehand.init();
const page = stagehand.context.pages()[0];

// 2. Playwright CDP — for secure credential fills only
const cdpBrowser = await chromium.connectOverCDP(session.connectUrl);
const cdpContext = cdpBrowser.contexts()[0];
const cdpPage = cdpContext.pages()[0];
```

### Destroying a Session

Sessions MUST be destroyed after every checkout (success or failure). Use try/finally.

```typescript
// Close Stagehand
await stagehand.close();

// Close Playwright CDP
await cdpBrowser.close();

// Belt-and-suspenders: explicit REST API release
await fetch(`https://api.browserbase.com/v1/sessions/${session.id}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-bb-api-key": process.env.BROWSERBASE_API_KEY,
  },
  body: JSON.stringify({ status: "REQUEST_RELEASE" }),
});
```

### Session Replay

Every session gets a replay URL for debugging:
```
https://www.browserbase.com/sessions/{session.id}
```

Store this in the order record. On `CHECKOUT_FAILED`, return it to the operator for investigation.

### Retry on 429

Browserbase has concurrent session limits. On HTTP 429, retry with exponential backoff:

```typescript
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 3000;

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const res = await fetch("https://api.browserbase.com/v1/sessions", { ... });
  if (res.ok) return res.json();
  if (res.status === 429 && attempt < MAX_RETRIES) {
    await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
    continue;
  }
  throw new Error(`Session creation failed (${res.status})`);
}
```

### Session Timeout

Hard timeout on every session. If a checkout takes longer than 5 minutes, kill it.

```typescript
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const timer = setTimeout(async () => {
  await destroySession(sessionId);
}, SESSION_TIMEOUT_MS);

try {
  // ... run checkout ...
} finally {
  clearTimeout(timer);
  await destroySession(sessionId);
}
```

---

## Stagehand Primitives

Stagehand provides three core methods + an agent mode. Bloon uses the primitives directly for maximum control.

### `act()` — Perform an Action

Natural language instruction → Stagehand identifies the element and acts on it.

```typescript
await stagehand.act("click the Add to Cart button");
await stagehand.act("select Standard Shipping from the shipping options");
await stagehand.act("dismiss the cookie banner");
```

With `variables` (values NOT shared with Stagehand's LLM):

```typescript
await stagehand.act("fill the email field with %email%", {
  variables: { email: "john@example.com" },
});
await stagehand.act("fill the shipping address with %street%", {
  variables: { street: "123 Main St" },
});
```

The `%var%` syntax is Stagehand's built-in credential protection — variables are substituted at the execution layer, never sent to the LLM provider.

### `observe()` — Find Actionable Elements

Returns a list of elements matching a description. Useful for discovering form fields before filling them.

```typescript
const fields = await stagehand.observe("find all form fields on the checkout page");
// Returns: [{ selector: "#email", description: "Email input" }, ...]

const payButton = await stagehand.observe("find the Place Order or Pay Now button");
```

### `extract()` — Extract Structured Data

Pulls data from the page using a Zod schema for type safety.

```typescript
import { z } from "zod";

const priceData = await stagehand.extract(
  "extract the order total, item price, tax, and shipping cost",
  z.object({
    itemPrice: z.string(),
    tax: z.string(),
    shipping: z.string(),
    total: z.string(),
  }),
);

// For confirmation page
const confirmation = await stagehand.extract(
  "extract the order confirmation number and final total",
  z.object({
    orderNumber: z.string(),
    total: z.string(),
  }),
);
```

Calling `extract()` with no arguments returns the page's accessibility tree text — used for confirmation signal matching.

### Why NOT `agent()`

Stagehand also has an `agent()` mode for autonomous multi-step tasks. We do NOT use it because:
1. The agent uses its own internal LLM (may default to Gemini) which could see credential values
2. Less control over individual steps — harder to insert CDP fills at the right moment
3. Harder to audit and debug

Instead, Bloon orchestrates the checkout step-by-step using `act()`, `observe()`, and `extract()`.

---

## Credential System

### Two-Tier Approach

| Field Type | Fill Method | Why |
|-----------|------------|-----|
| **Card number, CVV, expiry** | Playwright CDP `page.fill()` | Highest sensitivity — never touch any LLM |
| **Shipping, billing, email, phone** | Stagehand `act()` with `%var%` | Lower sensitivity — Stagehand's `variables` keeps them out of LLM context |

### Credential Map

```typescript
// credentials.ts
const CREDENTIAL_FIELDS: Record<string, () => string> = {
  // Card — filled via CDP only
  card_number: () => process.env.CARD_NUMBER!,
  card_expiry: () => process.env.CARD_EXPIRY!,
  card_cvv: () => process.env.CARD_CVV!,
  cardholder_name: () => process.env.CARDHOLDER_NAME!,

  // Billing — filled via Stagehand variables
  billing_street: () => process.env.BILLING_STREET!,
  billing_city: () => process.env.BILLING_CITY!,
  billing_state: () => process.env.BILLING_STATE!,
  billing_zip: () => process.env.BILLING_ZIP!,
  billing_country: () => process.env.BILLING_COUNTRY!,

  // Shipping — from request body (required for physical products)
  // (resolved at checkout time, not here)
};

const CDP_ONLY_FIELDS = new Set([
  "card_number", "card_expiry", "card_cvv", "cardholder_name",
]);

export function isCdpField(fieldName: string): boolean {
  return CDP_ONLY_FIELDS.has(fieldName);
}
```

### CDP Fill for Card Fields

When the checkout flow reaches the payment step, card fields are filled directly via the Playwright CDP connection. The LLM never sees the real values.

```typescript
// fill.ts
async function fillCardField(
  cdpPage: Page,
  selector: string,
  fieldName: string,
): Promise<void> {
  const value = CREDENTIAL_FIELDS[fieldName]();
  await cdpPage.locator(selector).fill(value);
}

// Usage during checkout:
// 1. Stagehand observes the payment form
const cardFields = await stagehand.observe("find the card number, expiry, and CVV input fields");

// 2. For each card field, fill via CDP (not Stagehand)
for (const field of cardFields) {
  if (isCdpField(field.fieldName)) {
    await fillCardField(cdpPage, field.selector, field.fieldName);
  }
}
```

### Flow Diagram

```
.env (local disk, chmod 600)
  │
  ├─ CARD_*, BILLING_*, SHIPPING_*
  │
  ├─ Card fields (card_number, card_cvv, card_expiry, cardholder_name)
  │   │
  │   ▼
  │   Playwright CDP → page.locator(selector).fill(realValue)
  │   LLM never involved. Value goes straight to DOM.
  │
  └─ Non-card fields (shipping, billing, email, phone)
      │
      ▼
      Stagehand act() with variables: { street: "123 Main St" }
      LLM sees: "fill the address field with %street%"
      Stagehand substitutes %street% → "123 Main St" at execution layer
      LLM log shows: "fill the address field with %street%" ← SAFE
```

### Verification (Post-Checkout)

After every checkout, verify no credential leaks:

```typescript
function verifyNoCredentialLeaks(logs: string): boolean {
  const cardNumber = process.env.CARD_NUMBER!;
  const cvv = process.env.CARD_CVV!;
  return !logs.includes(cardNumber) && !logs.includes(cvv);
}
```

---

## Checkout Orchestration

The checkout is driven step-by-step by server-side code using Stagehand primitives. Not a single autonomous agent run — each step is explicit.

### Step-by-Step Flow

```typescript
// task.ts
async function runCheckout(
  stagehand: Stagehand,
  cdpPage: Page,
  order: Order,
  credentials: CredentialMap,
): Promise<CheckoutResult> {

  // Phase 1: Navigate to product and add to cart
  await stagehand.act(`navigate to ${order.product.url}`);
  await stagehand.act("add the product to the cart");
  await stagehand.act("proceed to checkout");

  // Phase 2: Handle obstacles
  await stagehand.act(
    "dismiss any cookie banners, popups, modals, or overlays. " +
    "If there is a login wall, choose Guest Checkout or Continue as Guest."
  );

  // Phase 3: Fill shipping info (via Stagehand variables — safe)
  await stagehand.act("fill the shipping name field with %name%", {
    variables: { name: order.shipping.name },
  });
  await stagehand.act("fill the shipping address field with %street%", {
    variables: { street: order.shipping.street },
  });
  await stagehand.act("fill the city field with %city%", {
    variables: { city: order.shipping.city },
  });
  await stagehand.act("select %state% in the state dropdown", {
    variables: { state: order.shipping.state },
  });
  await stagehand.act("fill the ZIP code field with %zip%", {
    variables: { zip: order.shipping.zip },
  });
  await stagehand.act("fill the email field with %email%", {
    variables: { email: order.shipping.email },
  });
  await stagehand.act("fill the phone field with %phone%", {
    variables: { phone: order.shipping.phone },
  });

  // Select shipping method
  await stagehand.act("select the cheapest available shipping option");
  await stagehand.act("continue to the payment step");

  // Phase 4: Avoid express pay
  // Stagehand observes the page to find the standard card form
  await stagehand.act(
    "ignore any Shop Pay, Google Pay, Apple Pay, PayPal, Amazon Pay, or Venmo buttons. " +
    "Find and click the standard credit card payment option."
  );

  // Phase 5: Fill card fields via Playwright CDP (NEVER through Stagehand)
  const cardFields = await stagehand.observe(
    "find the card number input, expiry input, and CVV input fields. " +
    "If they are inside iframes, identify the iframe selectors."
  );
  for (const field of cardFields) {
    await fillCardField(cdpPage, field.selector, field.fieldName);
  }
  // Fill cardholder name and billing address via CDP too
  await fillCardField(cdpPage, cardholderSelector, "cardholder_name");

  // Phase 6: Verify price and submit
  const priceCheck = await stagehand.extract(
    "extract the order total from the checkout page",
    z.object({ total: z.string() }),
  );
  const finalTotal = parseFloat(priceCheck.total.replace(/[$,]/g, ""));
  const quotedTotal = parseFloat(order.payment.amount_usdc);

  if (Math.abs(finalTotal - quotedTotal) > Math.min(1, quotedTotal * 0.05)) {
    throw new PriceMismatchError(quotedTotal, finalTotal);
  }

  await stagehand.act("click the Place Order or Pay Now or Complete Purchase button");

  // Phase 7: Wait for confirmation
  await new Promise((r) => setTimeout(r, 5000)); // wait for confirmation page

  const pageText = await stagehand.extract();
  const confirmation = verifyConfirmationPage(pageText);

  if (!confirmation.isConfirmed) {
    throw new CheckoutFailedError(confirmation.reason);
  }

  const receipt = await stagehand.extract(
    "extract the order confirmation number and final total",
    z.object({
      orderNumber: z.string().optional(),
      total: z.string().optional(),
    }),
  );

  return {
    success: true,
    orderNumber: receipt.orderNumber,
    finalTotal: receipt.total,
    replayUrl: `https://www.browserbase.com/sessions/${session.id}`,
  };
}
```

### Why Step-by-Step, Not Autonomous

1. **Credential safety**: Card fields are filled via CDP between Stagehand steps — impossible if using a single autonomous agent run
2. **Price verification**: We check the total BEFORE clicking submit — can abort if mismatch
3. **Observability**: Each step is logged independently — easy to pinpoint where failures occur
4. **Control**: If a step fails, we can retry that specific step or abort cleanly

### Adapting to Different Sites

The step-by-step flow above is a template. Stagehand's natural language understanding handles site variations:
- "add the product to the cart" works whether the button says "Add to Cart", "Add to Bag", or "Buy Now"
- "proceed to checkout" works for cart pages, modals, or sidebar carts
- "select the cheapest shipping option" works regardless of how shipping options are presented

For sites with unusual flows, the `act()` instructions can be adjusted. The structure (navigate → shipping → payment → submit) stays the same.

---

## Price Discovery

Product discovery runs through three tiers. See `plans/16-firecrawl-discovery.md` for the full Firecrawl pipeline spec.

### Tier 1: Firecrawl (Primary, Rich)

Uses Firecrawl's `/extract` endpoint to pull structured product data from the rendered page — name, price, brand, image, variant options with values and per-variant pricing, and variant URLs. Three sub-steps:

1. `/extract` on product URL (always)
2. If variant URLs found → `/extract` on each variant URL for per-variant pricing
3. If options found but no variant URLs → `/crawl` (maxDepth: 1) to discover variant pages

Requires `FIRECRAWL_API_KEY`. Skipped if not set.

### Tier 2: HTML Scrape (Fast, Free)

Server-side HTTP fetch + structured data parsing. No API keys or browser sessions needed.

- JSON-LD (`@type: Product`) → extract name, price, variant options from `hasVariant`/`offers`
- Open Graph meta tags → `product:price:amount`, `og:title`
- Falls through to Tier 3 if bot-blocked or no structured data found

### Tier 3: Browserbase + Stagehand (Slow, Last Resort)

Launch a Browserbase headless Chrome session. Stagehand LLM agent extracts product info and variant options from the rendered DOM. For per-variant pricing, the agent selects each variant and reports the updated price.

Used for anti-bot sites (Amazon, Best Buy) and pages with no structured data or Firecrawl support.

```
discoverProduct(url)
  → discoverViaFirecrawl(url)     // Tier 1
  → scrapePriceWithOptions(url)   // Tier 2
  → discoverViaBrowser(url)       // Tier 3
  → throw QUERY_FAILED
```

---

## Confirmation Detection

After the checkout completes, verify the purchase actually succeeded.

### Text Signal Matching

Use `stagehand.extract()` to get the page text, then match against known signals:

```typescript
// confirm.ts
const POSITIVE_SIGNALS = [
  "thank you", "order confirmed", "payment successful",
  "payment complete", "order complete", "purchase complete",
  "receipt", "confirmation number", "order number",
  "successfully", "your order", "thanks for your",
];

const NEGATIVE_SIGNALS = [
  "card number", "pay now", "checkout", "billing address",
  "payment method", "enter your", "add to cart",
  "place order", "submit payment", "expiry date",
  "security code", "cvv", "cvc",
];

interface ConfirmationResult {
  isConfirmed: boolean;
  confidence: number;
  reason: string;
}

function verifyConfirmationPage(pageText: string): ConfirmationResult {
  const lower = pageText.toLowerCase();

  let positiveCount = 0;
  const positiveMatches: string[] = [];
  for (const signal of POSITIVE_SIGNALS) {
    if (lower.includes(signal)) {
      positiveCount++;
      positiveMatches.push(signal);
    }
  }

  let negativeCount = 0;
  const negativeMatches: string[] = [];
  for (const signal of NEGATIVE_SIGNALS) {
    if (lower.includes(signal)) {
      negativeCount++;
      negativeMatches.push(signal);
    }
  }

  if (positiveCount > 0 && positiveCount > negativeCount) {
    return {
      isConfirmed: true,
      confidence: Math.min(1, positiveCount / 3),
      reason: `Confirmation detected: ${positiveMatches.join(", ")}`,
    };
  }

  if (negativeCount > 0) {
    return {
      isConfirmed: false,
      confidence: Math.min(1, negativeCount / 3),
      reason: `Page still shows checkout form: ${negativeMatches.join(", ")}`,
    };
  }

  return {
    isConfirmed: false,
    confidence: 0,
    reason: "No confirmation or checkout signals found on page",
  };
}
```

---

## Checkout Execution Sequence

When `/api/confirm` is called for a browser route order:

```
1.  Load order from store
2.  Verify order status === "awaiting_confirmation"
3.  Verify not expired (< 5 min)
4.  Create fresh Browserbase session
9.  Initialize Stagehand + Playwright CDP on the session
10. Inject domain cache if available
11. Run checkout orchestration (step-by-step Stagehand calls)
12. Verify confirmation page (text signals)
13. Verify final total matches quote (±$1 or 5%)
14. Extract order number + confirmation details
15. Save domain cache
16. Destroy session (Stagehand + CDP + REST release)
17. Build receipt, update order status → "completed"
```

---

## Domain Cache

Fresh sessions per checkout means no state carries over. But we cache cookies and localStorage per domain to skip cookie banners and preserve preferences on repeat visits.

### What Gets Cached / What Does NOT

| Cached | NOT Cached |
|--------|-----------|
| Cookie consent state | Session tokens |
| Location/ZIP preferences | Auth cookies |
| Language preferences | Login state |
| localStorage entries | CSRF tokens |

### Storage

```
~/.bloon/cache/
  target.com.json
  bestbuy.com.json
  amazon.com.json
```

### Extracting Cache (After Checkout)

```typescript
// cache.ts
async function extractDomainCache(
  context: BrowserContext,
  page: Page,
  domain: string,
): Promise<DomainCache> {
  const cookies = await context.cookies();

  const safeCookies = cookies.filter((c) => {
    const name = c.name.toLowerCase();
    return !name.includes("session") &&
           !name.includes("token") &&
           !name.includes("auth") &&
           !name.includes("csrf");
  });

  const localStorage = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)!;
      items[key] = window.localStorage.getItem(key)!;
    }
    return items;
  });

  return { domain, cookies: safeCookies, localStorage, updated_at: new Date().toISOString() };
}
```

### Injecting Cache (Before Checkout)

```typescript
async function injectDomainCache(
  context: BrowserContext,
  page: Page,
  cache: DomainCache,
): Promise<void> {
  if (cache.cookies.length > 0) {
    await context.addCookies(cache.cookies);
  }

  await page.goto(`https://${cache.domain}`, { waitUntil: "domcontentloaded" });

  if (cache.localStorage && Object.keys(cache.localStorage).length > 0) {
    await page.evaluate((data) => {
      for (const [key, value] of Object.entries(data)) {
        localStorage.setItem(key, value);
      }
    }, cache.localStorage);
  }
}
```

---

## Known Challenges

### 1. Payment Iframes

**Problem**: Stripe Elements, Braintree hosted fields, and Adyen render card inputs inside cross-origin iframes.

**Mitigation**:
- Stagehand handles iframe and shadow DOM interactions automatically (documented feature)
- Playwright CDP can access cross-origin iframe content at the protocol level
- `stagehand.observe()` can identify fields inside iframes and return selectors that work across frame boundaries
- Test specifically against Stripe Elements early — it's the most common processor

### 2. Express Pay Distractions

**Problem**: Shopify, Target, Best Buy prominently display Shop Pay, Google Pay, Apple Pay buttons.

**Mitigation**: The checkout orchestration explicitly instructs Stagehand to "ignore Shop Pay, Google Pay, Apple Pay" and "find the standard credit card payment option."

### 3. Bot Detection

**Problem**: Amazon, Walmart, and some retailers use aggressive bot detection.

**Mitigation**:
- Browserbase provides: residential proxies, realistic fingerprints, CAPTCHA solving
- Start with Shopify stores (minimal detection), expand to Target, then stretch goals
- Browserbase's `solveCaptchas: true` handles most CAPTCHA challenges

### 4. Dynamic Forms

**Problem**: Forms with real-time validation, lazy-loaded fields, or conditional sections.

**Mitigation**:
- Stagehand's `observe()` re-reads the page before each action
- `act()` waits for elements to be actionable before interacting
- Step-by-step orchestration naturally adds delays between actions

### 5. Guest Checkout Requirement

**Problem**: Some sites require account creation. Browserbase sessions are fresh — no login state.

**Mitigation**: The checkout orchestration handles this: "If there is a login wall, choose Guest Checkout." For v1, focus on sites with guest checkout.

### 6. Address Autocomplete Dropdowns

**Problem**: Google Places autocomplete can interfere with address entry.

**Mitigation**: Stagehand's `act()` handles this naturally — it can type into the field and then select from the dropdown, or continue with manual entry. The natural language interface adapts to whatever the site presents.

---

## Error Handling

### Checkout-Specific Errors

| Error | When | Response |
|-------|------|----------|
| `CHECKOUT_FAILED` | Stagehand couldn't complete purchase | 502, set order to failed |
| `PRICE_MISMATCH` | Final total differs from quote | 409, abort before submit, no funds at risk |
| `PRICE_EXTRACTION_FAILED` | Discovery couldn't extract price | 502, try different URL |
| Session creation failure | Browserbase down or limit hit | Retry with backoff, then 502 |
| Session timeout | Checkout took > 5 min | 502, destroy session, set order to failed |

### Critical: USDC Already Sent

When `CHECKOUT_FAILED` fires after USDC transfer, this is the worst case:
1. Order status → `"failed"`
2. Error details preserved in order record
3. `error.refund_status` → `"pending_manual"`
4. Browserbase session replay URL preserved for debugging
5. Operator investigates manually

### Session Cleanup

Sessions MUST be destroyed in all code paths. Always use try/finally:

```typescript
const session = await createBrowserbaseSession();
const stagehand = await initStagehand(session);
const cdpBrowser = await chromium.connectOverCDP(session.connectUrl);

try {
  // ... run checkout ...
} finally {
  await stagehand.close();
  await cdpBrowser.close();
  await releaseSession(session.id);
}
```

---

## Testing

### Test Progression

| Priority | Site | Checkout Type | Key Test |
|----------|------|--------------|----------|
| 1 | Shopify DTC store | Standard form, guest | Baseline — must pass first |
| 2 | Target.com | Multi-step, standard | Retailer checkout |
| 3 | Best Buy | Multi-step, complex | Electronics retailer |
| 4 | Amazon.com | Complex, heavy bot detection | Stretch goal |

### Phase 4 Test Gates

**Baseline:**
```
[ ] createBrowserbaseSession() returns session with CDP URL
[ ] destroySession(id) succeeds
[ ] Stagehand initializes on Browserbase session
[ ] Playwright CDP connects to same session
```

**Stagehand primitives:**
```
[ ] stagehand.act("navigate to URL") works
[ ] stagehand.observe("find form fields") returns selectors
[ ] stagehand.extract("get price", schema) returns typed data
[ ] stagehand.act() with variables substitutes correctly
```

**Discovery:**
```
[ ] discover(shopify_url) returns { name, price }
[ ] discover(target_url) returns { name, price }
[ ] discover(bad_url) returns PRICE_EXTRACTION_FAILED
```

**Credential security:**
```
[ ] Card fields filled via CDP, not Stagehand
[ ] Stagehand LLM logs contain zero real card numbers
[ ] Non-card fields use %var% placeholders in Stagehand logs
```

**Full checkout:**
```
[ ] Shopify store: navigate → cart → checkout → fill → submit → confirmation
[ ] Target.com: same flow
```

**Domain cache:**
```
[ ] First visit creates ~/.bloon/cache/{domain}.json
[ ] Second visit injects cached cookies
[ ] No auth tokens in cache
```

### Credential Security Verification

After **every** browser checkout test:
- [ ] Stagehand LLM logs contain zero real card numbers
- [ ] Card fills only appear in CDP/Playwright logs
- [ ] Non-card fields show `%var%` placeholders in Stagehand logs
- [ ] No credentials in API response bodies
- [ ] No credentials in `~/.bloon/orders.json`

### Debugging Failed Checkouts

1. Check Browserbase session replay: `https://www.browserbase.com/sessions/{session_id}`
2. Review Stagehand action log (which `act()`/`observe()`/`extract()` calls were made)
3. Identify which step failed
4. Common failures:
   - Stagehand clicked express pay → tighten the `act()` instruction
   - Payment iframe not accessible → verify CDP fill works across frames
   - Bot detection → check if proxies were enabled
   - Form validation error → a required field wasn't filled

---

## Implementation Notes

### Why Claude Sonnet 4

- Stagehand uses an LLM for `act()`, `observe()`, and `extract()` calls
- Each checkout = many LLM calls
- Sonnet 4 is fast, cheap, and capable enough for structured checkout tasks
- Speed matters — faster responses = faster checkouts

### Shipping Data Sanitization

Shipping info comes from the agent's `/api/buy` request. Before passing to Stagehand `variables`, sanitize:

```typescript
function sanitizeShipping(shipping: ShippingInfo): ShippingInfo {
  return {
    name: shipping.name.replace(/[<>"'&;]/g, "").substring(0, 100),
    street: shipping.street.replace(/[<>"'&;]/g, "").substring(0, 200),
    // ... same for all fields
  };
}
```

Prevents prompt injection via shipping fields.

### Stagehand vs browser-use

Bloon uses Stagehand (not browser-use) because:
- **Same vendor**: Stagehand is built by Browserbase — tightest integration
- **TypeScript-native**: No Python dependency, runs natively in the Bloon stack
- **Primitives over agents**: `act()`/`observe()`/`extract()` give step-by-step control vs browser-use's autonomous agent loop
- **Built-in iframe/shadow DOM**: Stagehand handles these automatically
- **`variables` parameter**: Built-in credential protection without needing `sensitive_data` workarounds

---

## Reference: AgentPay Patterns

Bloon's checkout system draws from AgentPay's `StagehandProxy`. Key patterns adapted:

| AgentPay Pattern | Bloon Adaptation |
|-----------------|------------------|
| `StagehandProxy` — dual channel (Stagehand + CDP) | Same architecture: Stagehand for navigation, CDP for card fills |
| `fillField(selector, value)` via Playwright CDP | `fill.ts` — same approach, card values go direct to DOM |
| `EXCLUDED_TOOLS` — blocks `browserbase_stagehand_agent` | We don't use `agent()` at all — primitives only |
| `takeSnapshot()` via `browserbase_stagehand_extract` | `confirm.ts` — `extract()` for page text, then signal matching |
| `verifyConfirmationPage()` — positive/negative signals | Same signal lists, same scoring logic |
| `VALID_FIELD_NAMES` + `getCredentialValue()` | `credentials.ts` — same field map pattern |
| REST API session creation + 429 retry | `session.ts` — same REST API, same retry pattern |
| Session replay URL logging | Stored in order record + receipt |
| 10-minute idle timeout | 5-minute hard timeout (Bloon checkouts are non-interactive) |
