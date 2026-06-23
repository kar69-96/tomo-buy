/**
 * Site Profile — the cached representation of a domain's checkout flow.
 *
 * Written after a successful first-run analysis. Read before every
 * cached execution. The Flow Executor replays the endpoint chain
 * as pure HTTP, extracting dynamic values from previous responses.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │                       SiteProfile                           │
 * │                                                             │
 * │  domain: "example.com"                                      │
 * │  platform: "shopify"                                        │
 * │  bot_protection: "stealth"                                  │
 * │  stripe: { type: "server_side", pk: "pk_live_..." }         │
 * │                                                             │
 * │  endpoints: [                                               │
 * │    Step 0: GET  /products/shoe                              │
 * │    Step 1: POST /cart/add          ← capture cart_id        │
 * │    Step 2: POST /checkout          ← capture session_id     │
 * │    Step 3: POST /checkout/{sid}/shipping                    │
 * │    Step 4: GET  /checkout/{sid}/shipping_rates              │
 * │    Step 5: POST /checkout/{sid}/shipping_rate               │
 * │    Step 6: POST stripe /v1/payment_methods                  │
 * │    Step 7: POST /checkout/{sid}/complete                    │
 * │  ]                                                          │
 * │                                                             │
 * │  Each step has:                                             │
 * │    - URL pattern with {placeholders}                        │
 * │    - Payload template with value sources                    │
 * │    - Expected response fingerprint                          │
 * │    - Dynamic value extractions for downstream steps         │
 * └─────────────────────────────────────────────────────────────┘
 */

import type { PageType } from "./classification-signals.js";

// ---- Value extraction ----

/**
 * How to extract a dynamic value from a previous step's response.
 *
 * Examples:
 *   - Cart ID from JSON:   { type: "json_path", path: "$.token" }
 *   - CSRF from HTML meta: { type: "css_selector", path: 'meta[name="csrf-token"]', attribute: "content" }
 *   - Session from cookie: { type: "set_cookie", path: "checkout_session" }
 *   - Token from header:   { type: "response_header", path: "X-Checkout-Token" }
 *   - ID from redirect:    { type: "url_segment", path: "/checkout/([^/]+)", group: 1 }
 */
export type ValueSourceType =
  | "json_path"
  | "css_selector"
  | "regex"
  | "set_cookie"
  | "response_header"
  | "url_segment";

export interface ValueSource {
  /** How to extract the value. */
  readonly type: ValueSourceType;
  /** Extraction path — meaning depends on type:
   *  - json_path: JSONPath expression (e.g., "$.checkout.token")
   *  - css_selector: CSS selector string
   *  - regex: Regular expression with capture group
   *  - set_cookie: Cookie name
   *  - response_header: Header name
   *  - url_segment: Regex applied to response URL / Location header
   */
  readonly path: string;
  /** For css_selector: which attribute to read (default: textContent). */
  readonly attribute?: string;
  /** For regex/url_segment: which capture group (default: 1). */
  readonly group?: number;
}

/**
 * A dynamic value extracted from a previous step and injected into
 * a downstream step's URL, headers, or payload.
 */
export interface DynamicValue {
  /** Placeholder name used in URL patterns and payload templates (e.g., "checkout_session_id"). */
  readonly name: string;
  /** Which step's response to extract from (0-indexed). */
  readonly sourceStep: number;
  /** How to extract the value from that step's response. */
  readonly extraction: ValueSource;
}

// ---- Response fingerprint (staleness detection layer 2) ----

export interface ResponseFingerprint {
  /** For HTML: set of form field names found on the page. */
  readonly formFieldNames?: readonly string[];
  /** For HTML: set of form action paths. */
  readonly formActions?: readonly string[];
  /** For JSON: set of top-level response keys. */
  readonly jsonKeys?: readonly string[];
  /** Content-Type of the response. */
  readonly contentType?: string;
  /** Expected HTTP status code. */
  readonly statusCode?: number;
}

// ---- Token location ----

export type TokenLocationType = "meta_tag" | "cookie" | "response_header" | "json_path" | "hidden_input";

export interface TokenLocation {
  readonly type: TokenLocationType;
  /** Extraction path:
   *  - meta_tag: meta tag name attribute (e.g., "csrf-token")
   *  - cookie: cookie name
   *  - response_header: header name
   *  - json_path: JSONPath in API response
   *  - hidden_input: input name attribute
   */
  readonly path: string;
  /** Whether the token rotates per-request (true) or per-session (false). */
  readonly perRequest: boolean;
}

// ---- Field mapping ----

/**
 * Maps the site's field names to Bloon's standard field names.
 * e.g., { siteField: "administrative_area", standardField: "state" }
 */
export interface FieldMapping {
  readonly siteField: string;
  readonly standardField: string;
}

// ---- Endpoint step ----

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Where a payload value comes from during cached execution.
 * - USER_INPUT: from the user's order/shipping data
 * - PREVIOUS_RESPONSE: extracted via DynamicValue from a prior step
 * - PAGE_TOKEN: CSRF/session token from TokenLocation
 * - STATIC: hardcoded value that doesn't change between runs
 */
export type PayloadValueSource = "USER_INPUT" | "PREVIOUS_RESPONSE" | "PAGE_TOKEN" | "STATIC";

export interface PayloadField {
  /** Field name in the request body. */
  readonly fieldName: string;
  /** Where the value comes from. */
  readonly source: PayloadValueSource;
  /** For USER_INPUT: standard field name (e.g., "shipping.email").
   *  For PREVIOUS_RESPONSE: DynamicValue name.
   *  For PAGE_TOKEN: token name.
   *  For STATIC: the literal value. */
  readonly sourceKey: string;
}

export interface EndpointStep {
  /** Step index (0-based). */
  readonly index: number;
  /** HTTP method. */
  readonly method: HttpMethod;
  /** URL pattern with {placeholder} tokens for dynamic segments. */
  readonly urlPattern: string;
  /** Required headers beyond standard session headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body content type. */
  readonly contentType?: "application/json" | "application/x-www-form-urlencoded" | "multipart/form-data";
  /** Payload template — fields and their value sources. */
  readonly payload?: readonly PayloadField[];
  /** Dynamic values to extract from this step's response. */
  readonly extractions?: readonly DynamicValue[];
  /** Expected response fingerprint for staleness detection. */
  readonly fingerprint?: ResponseFingerprint;
  /** Expected redirect chain (domains in order). Empty = no redirects expected. */
  readonly expectedRedirectChain?: readonly string[];
  /** Max redirects before treating as stale (default: 5). */
  readonly maxRedirects?: number;
  /** What page type this step corresponds to (for debugging/logging). */
  readonly pageType?: PageType;
  /** Human-readable description of what this step does. */
  readonly description?: string;
}

// ---- Stripe integration ----

export type StripeConfirmationType = "client_side" | "server_side";

export interface StripeIntegration {
  /** Whether the store uses client-side or server-side confirmation. */
  readonly confirmationType: StripeConfirmationType;
  /** Stripe publishable key (pk_live_* or pk_test_*). */
  readonly publishableKey: string;
  /** For client-side: how to extract the client secret from the page. */
  readonly clientSecretSource?: ValueSource;
  /** For server-side: which step's endpoint receives the pm_ ID. */
  readonly merchantPaymentStep?: number;
}

// ---- Auth flow ----

export type AuthFlowType = "guest" | "login" | "register";

export interface AuthFlow {
  readonly type: AuthFlowType;
  /** Step index of the auth endpoint in the endpoint chain. */
  readonly stepIndex: number;
}

// ---- Bot protection ----

export type BotProtectionLevel = "none" | "stealth" | "full_browser";

// ---- Interstitial handling ----

export interface InterstitialHandling {
  /** What kind of interstitial (cookie consent, age verification, etc.). */
  readonly type: string;
  /** CSS selector for the dismiss/accept button. */
  readonly dismissSelector: string;
}

// ---- Staleness metadata ----

export interface StalenessMetadata {
  /** Base TTL in milliseconds (default: 7 days). */
  readonly baseTtlMs: number;
  /** Current effective TTL (halves after each invalidation, min 1 day). */
  readonly currentTtlMs: number;
  /** Number of times this profile has been invalidated and re-learned. */
  readonly invalidationCount: number;
  /** ISO timestamp of last successful cached execution. */
  readonly lastValidatedAt: string;
}

// ---- Platform type ----

export type PlatformType =
  | "shopify"
  | "woocommerce"
  | "bigcommerce"
  | "magento"
  | "custom"
  | "unknown";

// ---- Site Profile (top-level) ----

export interface SiteProfile {
  /** Domain this profile covers (e.g., "example.com"). */
  readonly domain: string;
  /** Detected e-commerce platform. */
  readonly platform: PlatformType;
  /** Bot protection level — determines HTTP routing strategy. */
  readonly botProtection: BotProtectionLevel;
  /** Whether this profile is eligible for HTTP-only cached execution. */
  readonly httpEligible: boolean;
  /** Ordered endpoint chain for the full checkout flow. */
  readonly endpoints: readonly EndpointStep[];
  /** Auth flow type and location in the endpoint chain. */
  readonly authFlow: AuthFlow;
  /** Payment processor integration details. */
  readonly stripe?: StripeIntegration;
  /** CSRF/session token locations. */
  readonly tokenLocations: readonly TokenLocation[];
  /** Field name mappings (site field → standard field). */
  readonly fieldMappings: readonly FieldMapping[];
  /** Interstitial pages encountered and how to dismiss them. */
  readonly interstitials: readonly InterstitialHandling[];
  /** Page classification for each URL in the funnel. */
  readonly pageClassifications: Readonly<Record<string, PageType>>;
  /** Staleness detection and TTL metadata. */
  readonly staleness: StalenessMetadata;
  /** ISO timestamp when this profile was first created. */
  readonly createdAt: string;
  /** ISO timestamp of the most recent profile update. */
  readonly updatedAt: string;
  /** Version counter — incremented on each re-learn. */
  readonly version: number;
}

// ---- Constants ----

/** Default base TTL for site profiles: 7 days. */
export const DEFAULT_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum TTL after adaptive decay: 1 day. */
export const MIN_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

/** Max redirects per endpoint step before treating as stale. */
export const MAX_REDIRECTS_PER_STEP = 5;

/** Jaccard similarity threshold for response fingerprint comparison. */
export const FINGERPRINT_SIMILARITY_THRESHOLD = 0.7;
