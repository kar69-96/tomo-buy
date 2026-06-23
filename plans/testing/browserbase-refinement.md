# Browserbase Refinement — Iterative Computer Use Testing

Iterative test harness for validating Browserbase + Stagehand browser checkout across real e-commerce sites. Uses upgraded Browserbase account with stealth mode, residential proxies, and automatic CAPTCHA solving.

**Goal**: One agnostic prompt that handles any e-commerce checkout page — guest or authenticated.

---

## Browserbase Configuration

Upgraded account enables all anti-detection features:

```typescript
const session = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-bb-api-key": process.env.BROWSERBASE_API_KEY,
  },
  body: JSON.stringify({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    proxies: true,                    // residential proxies
    browserSettings: {
      solveCaptchas: true,            // auto-solve CAPTCHAs
      recordSession: true,            // session replay for debugging
      logSession: true,               // network + console logs
      stealth: true,                  // stealth mode (upgraded)
    },
  }),
});
```

Key capabilities:
- **Stealth mode** — evades bot detection fingerprinting
- **Residential proxies** — real IP addresses, not datacenter
- **CAPTCHA solving** — Browserbase handles reCAPTCHA, hCaptcha, etc.
- **Session replay** — full visual replay at `https://www.browserbase.com/sessions/{id}`

---

## The Agnostic Prompt

A single orchestration flow that adapts to any e-commerce site. The prompt handles site variations through Stagehand's natural language understanding — no site-specific logic needed.

### Core Flow

```
1. Navigate to product URL
2. Dismiss overlays (cookie banners, popups, modals, newsletter signups)
3. Add product to cart
4. Proceed to checkout
5. Route: guest checkout vs login
   a. If guest checkout available → select it
   b. If login required → fill credentials via variables (agent never sees them)
6. Fill shipping info via Stagehand variables (%var% syntax)
7. Select cheapest shipping option
8. Skip express pay (Shop Pay, Google Pay, Apple Pay, PayPal, Amazon Pay)
9. Select standard credit card payment
10. Fill card fields via Playwright CDP (bypasses LLM entirely)
11. Extract order total → verify against expected price
12. Submit order
13. Wait for confirmation page
14. Extract confirmation number + final total
```

### Prompt Template

The checkout orchestration uses these Stagehand instructions. Each instruction is site-agnostic — Stagehand figures out the specific selectors.

**Phase 1 — Navigate & Cart**
```typescript
await stagehand.act(`navigate to ${productUrl}`);
await stagehand.act(
  "dismiss any cookie banners, popups, modals, newsletter signups, or overlays"
);
await stagehand.act("add the product to the cart. If there are size or variant options, select the first available option");
await stagehand.act("proceed to checkout or view cart and then proceed to checkout");
```

**Phase 2 — Guest vs Login**
```typescript
// First, try guest checkout
const guestOption = await stagehand.observe(
  "find any Guest Checkout, Continue as Guest, or Checkout without account option"
);

if (guestOption.length > 0) {
  await stagehand.act("select Guest Checkout or Continue as Guest");
} else {
  // Login required — credentials passed as variables, never seen by agent
  await stagehand.act("find and click the Sign In or Log In button");
  await stagehand.act("fill the email or username field with %login_email%", {
    variables: { login_email: credentials.email },
  });
  await stagehand.act("fill the password field with %login_password%", {
    variables: { login_password: credentials.password },
  });
  await stagehand.act("click the Sign In or Log In submit button");
  // Wait for redirect after login
  await stagehand.act("wait for the page to load after signing in");
  await stagehand.act("proceed to checkout");
}
```

**Phase 3 — Shipping**
```typescript
await stagehand.act("fill the first name field with %first_name%", {
  variables: { first_name: shipping.firstName },
});
await stagehand.act("fill the last name field with %last_name%", {
  variables: { last_name: shipping.lastName },
});
await stagehand.act("fill the street address field with %street%", {
  variables: { street: shipping.street },
});
await stagehand.act("fill the city field with %city%", {
  variables: { city: shipping.city },
});
await stagehand.act("select %state% in the state or province dropdown", {
  variables: { state: shipping.state },
});
await stagehand.act("fill the ZIP or postal code field with %zip%", {
  variables: { zip: shipping.zip },
});
await stagehand.act("fill the phone number field with %phone%", {
  variables: { phone: shipping.phone },
});
await stagehand.act("fill the email field with %email%", {
  variables: { email: shipping.email },
});
await stagehand.act("select the cheapest available shipping option");
await stagehand.act("continue to the payment step or click Continue or Next");
```

**Phase 4 — Payment**
```typescript
await stagehand.act(
  "ignore any Shop Pay, Google Pay, Apple Pay, PayPal, Amazon Pay, Venmo, or Afterpay buttons. " +
  "Find and select the standard credit card or debit card payment option."
);

// Card fields via Playwright CDP — LLM never sees these values
const cardFields = await stagehand.observe(
  "find the card number input, expiry date input, and CVV or security code input fields. " +
  "If they are inside iframes, identify the iframe selectors."
);
// Fill via CDP (see 12-computer-use.md for implementation)
for (const field of cardFields) {
  await fillCardFieldViaCDP(cdpPage, field.selector, field.fieldName);
}
```

**Phase 5 — Verify & Submit**
```typescript
const priceCheck = await stagehand.extract(
  "extract the order total from the checkout summary",
  z.object({ total: z.string() }),
);

// Verify price within tolerance before submitting
const finalTotal = parseFloat(priceCheck.total.replace(/[$,]/g, ""));
if (Math.abs(finalTotal - expectedTotal) > Math.min(1, expectedTotal * 0.05)) {
  throw new PriceMismatchError(expectedTotal, finalTotal);
}

await stagehand.act("click the Place Order or Pay Now or Complete Purchase or Submit Order button");
```

**Phase 6 — Confirmation**
```typescript
await new Promise((r) => setTimeout(r, 5000)); // wait for confirmation page

const confirmation = await stagehand.extract(
  "extract the order confirmation number, order ID, and final total from the confirmation or thank you page",
  z.object({
    orderNumber: z.string().optional(),
    total: z.string().optional(),
    message: z.string().optional(),
  }),
);
```

---

## Credential Handling

The agent **never** sees real credentials. Two mechanisms ensure this:

### Card Fields — Playwright CDP (Zero LLM Exposure)

Card number, CVV, and expiry are filled via Playwright's Chrome DevTools Protocol connection directly into the DOM. The Stagehand LLM is not involved at all.

### Login Credentials — Stagehand Variables (Zero LLM Exposure)

When a site requires login, the user provides credentials through the API. These are passed as Stagehand `variables` — the `%var%` syntax substitutes values at the execution layer. The LLM sees only the placeholder names, never the actual values.

```
LLM sees:  "fill the password field with %login_password%"
LLM log:   "fill the password field with %login_password%"
Execution: fills "correcthorsebatterystaple" into the password field
```

### Credential Lifecycle

1. User provides credentials via API request (e.g., `POST /api/confirm` with `credentials` field)
2. Server stores them in memory only — never written to disk, logs, or order records
3. Passed to Stagehand via `variables` parameter
4. Used once during the checkout session
5. Discarded when the session is destroyed — no persistence

### What the Agent Sees vs What It Doesn't

| Data | Agent Sees? | Method |
|------|-------------|--------|
| Product URL, name, price | Yes | Direct |
| Shipping name, address | Placeholder only (`%var%`) | Stagehand variables |
| Email, phone | Placeholder only (`%var%`) | Stagehand variables |
| Login email | Placeholder only (`%login_email%`) | Stagehand variables |
| Login password | Placeholder only (`%login_password%`) | Stagehand variables |
| Card number | **No** | Playwright CDP |
| Card CVV | **No** | Playwright CDP |
| Card expiry | **No** | Playwright CDP |

---

## Test Websites

### Tier 1 — Must Pass (Simple Checkout)

| Site | URL Pattern | Guest Checkout? | Key Challenges |
|------|-------------|-----------------|----------------|
| **Shopify store** | Any Shopify DTC brand | Yes | Baseline — simplest flow |
| **Target.com** | `target.com/p/...` | Yes | Multi-step checkout, address autocomplete |
| **Best Buy** | `bestbuy.com/site/...` | Yes | Electronics, warranty upsells |

### Tier 2 — Should Pass (Moderate Complexity)

| Site | URL Pattern | Guest Checkout? | Key Challenges |
|------|-------------|-----------------|----------------|
| **Walmart.com** | `walmart.com/ip/...` | Yes | Bot detection, dynamic forms |
| **Nike.com** | `nike.com/t/...` | Yes | Size selection, high demand items |
| **Etsy** | `etsy.com/listing/...` | Yes (partial) | Marketplace, seller variations |

### Tier 3 — Stretch Goals (Complex / Login Required)

| Site | URL Pattern | Guest Checkout? | Key Challenges |
|------|-------------|-----------------|----------------|
| **Amazon.com** | `amazon.com/dp/...` | No — login required | Aggressive bot detection, complex UI |
| **eBay** | `ebay.com/itm/...` | Partial | Auction vs Buy Now, seller variations |
| **Costco** | `costco.com/...` | No — membership required | Login + membership verification |
| **Apple Store** | `apple.com/shop/...` | Yes | Custom configuration flows |

### Test Products (Low-Value, Shippable)

Use cheap products to minimize cost during testing:

| Site | Product | ~Price | Why |
|------|---------|--------|-----|
| Shopify | Sticker pack or small accessory | $5-10 | Simplest checkout |
| Target | Basic household item (sponge, pen) | $3-8 | Standard retail flow |
| Best Buy | USB cable or phone case | $5-15 | Electronics path |
| Walmart | Basic grocery/household item | $3-8 | Walmart-specific flow |
| Amazon | Small accessory or book | $5-15 | Login-required path |

---

## Test Cases

### TC-01: Session Creation & Stealth

```
Verify:
[ ] Session creates with proxies, stealth, and CAPTCHA solving enabled
[ ] Session replay URL is accessible
[ ] Session destroys cleanly after test
[ ] No bot detection triggered on Target.com homepage
[ ] No bot detection triggered on Amazon.com homepage
[ ] CAPTCHA encountered → auto-solved by Browserbase
```

### TC-02: Navigation & Cart (Per Site)

```
For each Tier 1 site:
[ ] Navigate to product URL → page loads
[ ] Cookie banners dismissed automatically
[ ] Popups/modals closed
[ ] Product added to cart
[ ] Proceed to checkout succeeds
```

### TC-03: Guest Checkout Flow

```
For each site with guest checkout (Target, Best Buy, Walmart, Shopify):
[ ] Guest checkout option detected
[ ] Guest checkout selected
[ ] Shipping form loads
[ ] All shipping fields filled via %var% variables
[ ] Cheapest shipping option selected
[ ] Payment step reached
[ ] Express pay buttons ignored
[ ] Standard card payment selected
[ ] Card fields filled via CDP
[ ] Order total extracted correctly
[ ] Order submitted
[ ] Confirmation page detected
[ ] Order number extracted
```

### TC-04: Login Flow (Amazon, Costco)

```
For each login-required site:
[ ] Login requirement detected (no guest checkout option)
[ ] User prompted for credentials via API
[ ] Email/username filled via %login_email% variable
[ ] Password filled via %login_password% variable
[ ] LLM logs show ONLY placeholder names, never real values
[ ] Login succeeds
[ ] Redirected to checkout or homepage → navigate to checkout
[ ] Remainder of checkout proceeds as normal (TC-03 Phase 3+)
[ ] Credentials discarded after session destroy
```

### TC-05: Price Extraction Accuracy

```
For each test product:
[ ] Extracted price matches listed price on product page
[ ] Tax calculated (if shown before payment)
[ ] Shipping cost extracted
[ ] Order total matches expected (±5% or ±$1)
[ ] Price mismatch → order NOT submitted, error returned
```

### TC-06: Credential Security Audit

```
After every test run:
[ ] Stagehand LLM logs contain zero real card numbers
[ ] Stagehand LLM logs contain zero real passwords
[ ] Stagehand LLM logs show only %var% placeholders for all sensitive fields
[ ] Card fills appear only in CDP/Playwright logs
[ ] No credentials in API response bodies
[ ] No credentials written to disk (~/.bloon/)
[ ] No credentials in Browserbase session logs (verify via replay)
[ ] Login credentials not persisted after session destroy
```

### TC-07: Error Recovery

```
[ ] Product out of stock → detect and return meaningful error
[ ] Invalid product URL → PRICE_EXTRACTION_FAILED
[ ] Site down or unreachable → URL_UNREACHABLE
[ ] Checkout form validation error → retry or return error
[ ] Session timeout (>5 min) → session destroyed, error returned
[ ] CAPTCHA not solvable → error returned with replay URL
[ ] Price changed during checkout → PRICE_MISMATCH, order NOT submitted
[ ] Payment declined → detect decline message, return error
```

### TC-08: Express Pay Avoidance

```
For each site that shows express pay options:
[ ] Shop Pay button present → ignored
[ ] Google Pay button present → ignored
[ ] Apple Pay button present → ignored
[ ] PayPal button present → ignored
[ ] Amazon Pay button present → ignored
[ ] Standard card form found and selected instead
```

### TC-09: Address Autocomplete Handling

```
For sites with Google Places or similar autocomplete:
[ ] Address typed into field
[ ] Autocomplete dropdown appears → either select matching suggestion or continue typing
[ ] Full address successfully submitted
[ ] No address validation errors
```

### TC-10: Domain Cache (Repeat Visits)

```
[ ] First visit to site → domain cache created (~/.bloon/cache/{domain}.json)
[ ] Cache contains cookies (consent state, preferences)
[ ] Cache does NOT contain session tokens or auth cookies
[ ] Second visit → cache injected before navigation
[ ] Cookie banner not shown on second visit
[ ] Checkout flow still completes on second visit
```

---

## Iterative Test Loop

The test harness runs each site through the agnostic prompt and records results. Each iteration refines the prompt.

### Loop Structure

```
for each site in test_websites:
  1. Create Browserbase session (stealth + proxies + captcha solving)
  2. Initialize Stagehand + Playwright CDP
  3. Run agnostic checkout prompt
  4. Record result:
     - SUCCESS: confirmation number, total, time elapsed
     - FAILURE: step that failed, error message, replay URL
  5. Destroy session
  6. Log credential security audit results

After each round:
  - Review failures via Browserbase session replay
  - Identify which step failed and why
  - Adjust the agnostic prompt if needed (tighten act() instructions)
  - Re-run failed sites
  - Repeat until all Tier 1 sites pass consistently
```

### Result Tracking

Each test run produces a result record:

```typescript
interface TestResult {
  site: string;
  productUrl: string;
  timestamp: string;
  sessionId: string;
  replayUrl: string;
  result: "success" | "failure";
  failureStep?: string;        // e.g., "Phase 2 — Guest Checkout"
  failureReason?: string;      // e.g., "Could not find guest checkout option"
  confirmationNumber?: string;
  extractedTotal?: string;
  expectedTotal?: string;
  timeElapsedMs?: number;
  credentialAudit: {
    cardNumberExposed: boolean;
    passwordExposed: boolean;
    allPlaceholdersUsed: boolean;
  };
}
```

### Success Criteria

| Tier | Target | Definition |
|------|--------|-----------|
| Tier 1 | 100% pass rate | All 3 sites complete checkout on 3 consecutive runs |
| Tier 2 | 80% pass rate | At least 2 of 3 sites complete checkout |
| Tier 3 | Best effort | Any success is a bonus; document failures for v2 |

---

## Debugging Failures

When a test fails:

1. **Session replay** — `https://www.browserbase.com/sessions/{sessionId}` — watch the visual playback
2. **Identify the step** — which `act()` / `observe()` / `extract()` call failed?
3. **Common failure patterns**:

| Failure | Cause | Fix |
|---------|-------|-----|
| Clicked express pay | Stagehand chose wrong button | Tighten `act()` instruction: explicitly list buttons to ignore |
| Shipping form incomplete | Field not detected or wrong field filled | Use `observe()` first to list all fields, then fill individually |
| Bot detection blocked | Fingerprinting or behavioral detection | Verify stealth mode + proxies enabled, add delays between actions |
| CAPTCHA not solved | Browserbase solver failed | Check session logs, retry, report to Browserbase if persistent |
| Payment iframe inaccessible | Cross-origin iframe blocked CDP | Use Stagehand's built-in iframe handling, or locate iframe selector manually |
| Login failed | Credentials variable not substituted | Verify `%var%` syntax, check Stagehand version supports variables |
| Address autocomplete conflict | Typing interrupted by dropdown | Add explicit instruction to handle or dismiss autocomplete |
| Price mismatch | Tax or shipping changed | Widen tolerance or extract price after shipping selection |
| Out of stock | Product unavailable | Use a different test product |
| Session timeout | Checkout took > 5 min | Optimize steps, reduce waits, or increase timeout |

4. **Adjust prompt** — refine the agnostic prompt for the specific failure
5. **Re-run** — test the fix against the same site
6. **Document** — record what changed and why in this file

---

## Environment Variables

Required in `.env` for testing:

```bash
# Browserbase (upgraded account)
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...

# Stagehand LLM
ANTHROPIC_API_KEY=...

# Card credentials (for CDP fills — never seen by LLM)
CARD_NUMBER=4111111111111111
CARD_EXPIRY=12/28
CARD_CVV=123
CARDHOLDER_NAME=Test User

# Shipping (for Stagehand variables)
SHIPPING_FIRST_NAME=Test
SHIPPING_LAST_NAME=User
SHIPPING_STREET=123 Main St
SHIPPING_CITY=San Francisco
SHIPPING_STATE=CA
SHIPPING_ZIP=94102
SHIPPING_PHONE=4155551234
SHIPPING_EMAIL=test@example.com

# Login credentials (for sites requiring auth — used as Stagehand variables)
# These are set per-test, not permanently stored
# AMAZON_EMAIL=...
# AMAZON_PASSWORD=...
```

---

## Notes

- All tests use the upgraded Browserbase account — stealth mode, proxies, and CAPTCHA solving are always on
- Every session is fresh — no login state carries over between tests
- Card fields are ALWAYS filled via Playwright CDP, never through Stagehand
- Login credentials are ALWAYS passed as Stagehand `%var%` variables
- The agent orchestrating the checkout sees only placeholder names
- Session replay URLs are the primary debugging tool — use them before adjusting prompts
- Start with Tier 1 sites and don't move to Tier 2 until Tier 1 passes consistently
- Document every prompt adjustment and why it was needed

---

## Progress

### What Works

| Capability | Status | Notes |
|-----------|--------|-------|
| **Browserbase session creation** | Working | Sessions create reliably with stealth, proxies, CAPTCHA solving, recording |
| **Browserbase session replay** | Working | All sessions have valid replay URLs at `browserbase.com/sessions/{id}` |
| **Session destroy / cleanup** | Working | `finally` block always cleans up, even on crash |
| **Stagehand initialization** | Working | Claude Sonnet 4 via `anthropic/claude-sonnet-4-20250514` connects to Browserbase sessions |
| **Navigation to product pages** | Working | `page.goto()` + `waitForTimeout` reliably loads product pages |
| **Popup/overlay dismissal** | Working | `act("Dismiss any popups...")` handles cookie banners, modals, newsletter signups |
| **Variant selection (simple)** | Partial | Works when there's a clear size/color picker; fails on complex configurators |
| **Add to cart** | Partial | Works on standard "Add to Cart" buttons; struggles with non-standard UI (e.g., "Add to Bag" in drawers) |
| **Cart navigation (popup/drawer)** | Partial | Post-add-to-cart popup detection works on some Shopify stores; falls back to cart icon click |
| **Cart page → Checkout button** | Partial | Works when URL contains `/cart`; doesn't handle all checkout button patterns |
| **Guest checkout selection** | Working | After prompt refinement, navigates past login walls on Shopify (guest checkout, continue as guest) |
| **Email field fill** | Working | Field-by-field approach works; correctly targets checkout form email, not newsletter |
| **Name field fill** | Working | Handles both split (first/last) and combined name fields |
| **Shipping address fill** | Intermittent | Individual fields work but hit Stagehand schema bug intermittently (see Known Issues) |
| **Step-level error tracking** | Working | `CheckoutResult` now includes `failedStep`, `errorMessage`, `durationMs` |
| **Dry-run mode** | Working | `dryRun: true` stops before clicking Place Order, extracts diagnostics |
| **Price verification** | Working | `isPriceAcceptable()` catches mismatches within 5% or $1 tolerance |
| **Card field observation** | Untested | `stagehand.observe()` for card fields not yet reached in any successful run |
| **Card CDP fill** | Untested | `fillAllCardFields()` via Playwright not yet reached |
| **Domain cache (inject/extract)** | Untested | Cache loading/saving code exists but not yet exercised in successful runs |

### What Doesn't Work

| Issue | Severity | Affected Steps | Details |
|-------|----------|---------------|---------|
| **Stagehand `arguments` schema bug** | High | fill-shipping, fill-billing | LLM intermittently returns `"arguments": "%var%"` (string) instead of `"arguments": ["%var%"]` (array). Zod validation fails with `AI_NoObjectGeneratedError`. Documented in Stagehand Issues #676, #1204. Field-by-field `act()` calls reduce frequency but don't eliminate it. |
| **Stagehand `elementId` format bug** | Medium | add-to-cart, proceed-to-checkout | LLM returns `"2686"` instead of `"2-686"` or `"<UNKNOWN>"`, failing Stagehand's internal regex validation. Causes retries via self-healing, sometimes recovers. |
| **`no actionable element returned by LLM`** | Medium | various | Stagehand finds elements but can't resolve the xpath. Self-healing retry sometimes works, sometimes fails after max retries. |
| **Target.com bot detection** | High | navigate / add-to-cart | Target's anti-bot system blocks or redirects even with stealth mode + residential proxies. Multiple runs (6+) all failed. May need Browserbase fingerprint config tuning. |
| **Price regex too greedy** | Low | verify-price | `/$?([\d,]+\.?\d*)/` matches first number on page, not necessarily the order total. When `price: "0"` is used (test harness), any number triggers a mismatch. |
| **Non-Shopify checkout flows** | Untested | all | Only Shopify stores have been tested end-to-end. Target, Best Buy, Walmart, Amazon flows are completely untested beyond navigation. |

### Checkout Flow Analysis by Site Type

#### Shopify Stores (Tier 1)

**Furthest step reached:** `fill-shipping` → individual fields (email, name work; city intermittently fails due to schema bug)

**Flow pattern:**
1. Product page → dismiss popups → select variant → "Add to Cart" button
2. Post-add popup/drawer appears → click "View cart & check out" or fall back to cart icon
3. Cart page → "Check Out" button (often at `/cart`)
4. Shopify checkout at `checkout.shopify.com` → email → shipping → payment
5. Guest checkout available (no login required)

**What works:** Steps 1-4 work reliably after prompt refinements. Guest checkout navigation succeeds. Email fill works.

**What fails:** Shipping field fills intermittently fail due to Stagehand schema bug. When all fields succeed, the flow gets to `select-shipping` or `verify-price`.

**Sites tested:** bombas.com, pipsnacks.com, brooklinen.com, holstee.com, ugmonk.com

#### Target.com (Tier 2)

**Furthest step reached:** `add-to-cart` (bot detection blocks progress)

**Flow pattern:**
1. Product page → dismiss popups → "Add to cart" button
2. Cart overlay → "View cart & check out"
3. Multi-step checkout (shipping → payment → review)
4. Guest checkout available

**What fails:** Target's anti-bot system detects automation even with Browserbase stealth mode + residential proxies. Navigation succeeds but interactions trigger blocks. 6+ attempts all failed.

**Recommendation:** Deprioritize until Browserbase fingerprint tuning or Target-specific stealth settings are available.

#### Best Buy / Walmart / Amazon (Tier 2-3)

**Status:** Untested. No runs attempted yet.

### Known Stagehand v3.0.8 Issues

1. **`AI_NoObjectGeneratedError` — arguments string vs array** (Issue [#676](https://github.com/browserbase/stagehand/issues/676), [#1204](https://github.com/browserbase/stagehand/issues/1204))
   - When using `%var%` syntax, the LLM occasionally returns `"arguments": "%var%"` (string) instead of `"arguments": ["%var%"]` (array)
   - Zod schema validation rejects the response
   - Workaround: field-by-field `act()` calls reduce surface area, but bug persists intermittently
   - Fix needed: Stagehand should coerce string → array when schema expects array

2. **`elementId` format mismatch**
   - LLM returns element IDs like `"2686"` instead of Stagehand's expected `"2-686"` format
   - Also returns `"<UNKNOWN>"` when no element matches
   - Self-healing retry handles this sometimes, but burns retries

3. **`no actionable element returned by LLM`**
   - Element identified but xpath resolution fails
   - Occurs when page DOM changes between observation and action
   - Self-healing sometimes recovers

### Prompt Refinements Applied

| Version | Change | Why |
|---------|--------|-----|
| v1 | Original single-prompt approach | Baseline |
| v2 | Moved popup dismissal before add-to-cart | Overlays were blocking the add-to-cart button |
| v3 | Split add-to-cart into variant selection + button click | Stagehand was treating variant dropdown selection as "adding to cart" |
| v4 | Split cart navigation into popup/drawer detection + cart page fallback | Cart slide-out drawers weren't navigating to actual cart page |
| v5 | Added explicit guest checkout navigation after cart checkout button | Shopify login walls were blocking progress |
| v6 | Split shipping fill from single mega-prompt to field-by-field `act()` calls | Reduced Stagehand schema bug frequency |
| v7 | Added "Do NOT fill newsletter" to email prompt | Stagehand was filling footer newsletter email instead of checkout email |

### Next Steps

1. **Replenish Anthropic API credits** — all testing blocked until credits available
2. **Run full Tier 1 loop** — test 3+ Shopify stores to establish pass rate baseline
3. **Add retry wrapper for schema bug** — wrap individual `act()` calls in a retry loop (2-3 attempts) to handle intermittent schema failures
4. **Fix price verification for dry-run** — skip price check when `order.payment.price === "0"` (test harness uses placeholder)
5. **Test card field observation + CDP fill** — need to reach payment step on a Shopify store
6. **Explore Stagehand v3 alpha** — check if alpha releases fix the schema bug
7. **Target.com stealth investigation** — work with Browserbase support on fingerprint tuning

---

## Run Log

Living record of every test run. After each run, append a new entry below. Each entry captures what happened, what worked, what failed, and what to change for the next iteration.

### Template

Copy this template for each new run:

```
### Run #X — YYYY-MM-DD HH:MM

**Sites tested:** [list]
**Session IDs:** [list with replay URLs]
**Prompt version:** vX (describe changes from previous version)

#### Results

| Site | Result | Failed Step | Replay URL |
|------|--------|-------------|------------|
| ... | SUCCESS / FAILURE | — / Phase X | https://... |

#### Successes
- What worked well

#### Failures
- Site — what went wrong, which step, error message

#### Credential Audit
- [ ] LLM logs clean (no real card numbers)
- [ ] LLM logs clean (no real passwords)
- [ ] All sensitive fields used %var% placeholders

#### Prompt Changes for Next Run
- What to change in the agnostic prompt and why
- Specific act()/observe()/extract() instructions to tighten or loosen

#### Open Questions
- Anything unresolved that needs investigation
```

---

### Runs

_No runs recorded yet. First run will be logged below._

### Run — 2026-02-23 15:56

**URL:** https://www.bombas.com/products/womens-ankle-sock-4-pack
**Session:** [d7692372-78ab-46d0-a48a-fd86ca52f9bf](https://browserbase.com/sessions/d7692372-78ab-46d0-a48a-fd86ca52f9bf)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 62.7s

---

### Run — 2026-02-23 15:58

**URL:** https://www.target.com/p/scotch-brite-non-scratch-scrub-sponge/-/A-14779553
**Session:** [f884853c-ba19-4725-b842-7f7aba8bbb44](https://browserbase.com/sessions/f884853c-ba19-4725-b842-7f7aba8bbb44)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 29.7s

---

### Run — 2026-02-23 16:00

**URL:** https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690
**Session:** [c9e5ea88-c863-4ac4-ba4f-d670d2005039](https://browserbase.com/sessions/c9e5ea88-c863-4ac4-ba4f-d670d2005039)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 73.9s

---

### Run — 2026-02-23 16:02

**URL:** https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690
**Session:** [1272ef70-d7f2-4549-a119-25da398e45b8](https://browserbase.com/sessions/1272ef70-d7f2-4549-a119-25da398e45b8)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 96.4s

---

### Run — 2026-02-23 16:10

**URL:** https://pipsnacks.com/products/classic-heirloom-popcorn
**Session:** [8395c7c1-4e7e-4534-83dc-8b9b9a86e1a1](https://browserbase.com/sessions/8395c7c1-4e7e-4534-83dc-8b9b9a86e1a1)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 57.0s

---

### Run — 2026-02-23 16:13

**URL:** https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690
**Session:** [e8a778d2-0940-4d85-b370-f7feb4dd1d57](https://browserbase.com/sessions/e8a778d2-0940-4d85-b370-f7feb4dd1d57)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 54.1s

---

### Run — 2026-02-23 16:15

**URL:** https://www.brooklinen.com/products/classic-core-sheet-set
**Session:** [488c27c9-d1bf-4e91-bd10-4c2c9e70827e](https://browserbase.com/sessions/488c27c9-d1bf-4e91-bd10-4c2c9e70827e)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 98.0s

---

### Run — 2026-02-23 16:18

**URL:** https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690
**Session:** [1e8ea35c-0095-418f-bfbf-fd2f7153b3d4](https://browserbase.com/sessions/1e8ea35c-0095-418f-bfbf-fd2f7153b3d4)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 65.7s

---

### Run — 2026-02-23 16:19

**URL:** https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690
**Session:** [2a682c25-5a1b-48c4-b408-f6a17f4328ac](https://browserbase.com/sessions/2a682c25-5a1b-48c4-b408-f6a17f4328ac)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 59.0s

---

### Run — 2026-02-23 16:27

**URL:** https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690
**Session:** [aa89b49a-7c61-4de4-8104-28fc1f73c23b](https://browserbase.com/sessions/aa89b49a-7c61-4de4-8104-28fc1f73c23b)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 56.1s

---

### Run — 2026-02-23 16:29

**URL:** https://www.holstee.com/products/reflection-cards
**Session:** [5d5d296e-d415-4801-a2aa-a3fa89ba3fb9](https://browserbase.com/sessions/5d5d296e-d415-4801-a2aa-a3fa89ba3fb9)
**Result:** FAILURE
**Extracted total:** —
**Duration:** 85.8s

---

### Loop Run — 2026-02-23 16:38

**Sites tested:** 1 | **Passed:** 0 | **Failed:** 1

| Site | Tier | Result | Failed Step | Error | Duration | Replay |
|------|------|--------|-------------|-------|----------|--------|
| Shopify — Ugmonk Gather (simple product) | 1 | FAIL | add-to-cart | AI_APICallError: Your credit balance is too low to access the Anthropic API. Ple | 30.3s | [replay](https://browserbase.com/sessions/40b44b1a-a080-4e05-bfab-ae3eb1c215d9) |

---

### Loop Run — 2026-02-23 16:43

**Sites tested:** 1 | **Passed:** 0 | **Failed:** 1

| Site | Tier | Result | Failed Step | Error | Duration | Replay |
|------|------|--------|-------------|-------|----------|--------|
| Shopify — Ugmonk Gather (simple product) | 1 | FAIL | add-to-cart | AI_APICallError: Your credit balance is too low to access the Anthropic API. Ple | 29.5s | [replay](https://browserbase.com/sessions/ee0584ce-cb5b-483d-bbaf-ac73d0e05f2c) |

---

### Run — 2026-02-23 23:43

**URL:** https://ugmonk.com/products/analog-cards-3-pack
**Session:** [89981683-d5b0-4b11-b694-92062afaf06c](https://browserbase.com/sessions/89981683-d5b0-4b11-b694-92062afaf06c)
**Result:** FAILURE
**Failed step:** add-to-cart
**Error:** AI_APICallError: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.
**Extracted total:** —
**Duration:** 29.0s

---

### Run — 2026-02-24 23:30

**URL:** https://checkout.hydrogen.shop/products/the-full-stack-snowboard
**Session:** [85813592-1f83-408d-b1cc-de43822c5ebe](https://browserbase.com/sessions/85813592-1f83-408d-b1cc-de43822c5ebe)
**Result:** FAILURE
**Failed step:** add-to-cart
**Error:** AI_NoObjectGeneratedError: No object generated: response did not match schema.
{
  "cause": {
    "name": "AI_TypeValidationError",
    "message": "Type validation failed: Value: {\"elementId\":\"<UNK
**Extracted total:** —
**Duration:** 53.0s

---

### Run — 2026-02-26 02:22

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [2ed6fd6d-d26f-43f0-b04f-2138db2f234c](https://browserbase.com/sessions/2ed6fd6d-d26f-43f0-b04f-2138db2f234c)
**Result:** SUCCESS (dry-run)
**Extracted total:** 108.00
**Duration:** 664.5s

---

### Run — 2026-02-26 08:46

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [0040f168-5aec-4ef3-9d81-68f3ac497384](https://browserbase.com/sessions/0040f168-5aec-4ef3-9d81-68f3ac497384)
**Result:** FAILURE
**Failed step:** navigate
**Error:** StagehandEvalError: Uncaught
**Extracted total:** —
**Duration:** 16.1s

---

### Run — 2026-02-26 08:47

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [c9bdeb10-3b9a-4af6-bddd-781faa7f933b](https://browserbase.com/sessions/c9bdeb10-3b9a-4af6-bddd-781faa7f933b)
**Result:** FAILURE
**Failed step:** navigate
**Error:** StagehandEvalError: Uncaught
**Extracted total:** —
**Duration:** 16.5s

---

### Run — 2026-02-26 09:28

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [7464180a-b6fb-4ea0-90f7-5d219049bd8b](https://browserbase.com/sessions/7464180a-b6fb-4ea0-90f7-5d219049bd8b)
**Result:** SUCCESS (dry-run)
**Extracted total:** 216.00
**Duration:** 1330.6s

---

### Run — 2026-02-26 09:50

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [5c13dfd6-def6-4a32-af9a-562fb0f9cb9b](https://browserbase.com/sessions/5c13dfd6-def6-4a32-af9a-562fb0f9cb9b)
**Result:** SUCCESS (dry-run)
**Extracted total:** 324.00
**Duration:** 1296.6s

---

### Run — 2026-02-26 13:45

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [773f88cc-7e8a-42a4-be0e-88c35627de4d](https://browserbase.com/sessions/773f88cc-7e8a-42a4-be0e-88c35627de4d)
**Result:** SUCCESS (dry-run)
**Extracted total:** 432.00
**Duration:** 662.8s

---

### Run — 2026-02-26 13:49

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [15cc1078-a90a-4dca-a3a9-be5031c495b8](https://browserbase.com/sessions/15cc1078-a90a-4dca-a3a9-be5031c495b8)
**Result:** FAILURE
**Extracted total:** 
**Duration:** 263.1s

---

### Run — 2026-02-26 13:58

**URL:** https://www.allbirds.com/products/mens-tree-runners
**Session:** [509ee1ec-1692-42e5-b0b4-f0060b9b32ef](https://browserbase.com/sessions/509ee1ec-1692-42e5-b0b4-f0060b9b32ef)
**Result:** SUCCESS (dry-run)
**Extracted total:** 540.00
**Duration:** 472.0s

---
