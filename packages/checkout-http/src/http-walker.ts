/**
 * HTTP Walker — first-run checkout flow analysis.
 *
 * Walks a checkout funnel stage-by-stage via HTTP, recording every
 * request/response for profile building. Uses the SPA scorer to
 * decide between HTTP fetch and browser rendering, the page classifier
 * to understand each page, and the field mapper to identify form fields.
 *
 * Stops before real payment on first run (dry-run mode, the default).
 *
 * ┌──────────────────────────────────────────────────────┐
 * │                   HTTP Walker Flow                    │
 * │                                                       │
 * │  1. Fetch product page (HTTP or browser render)       │
 * │  2. Detect platform (Shopify/WooCommerce/etc.)        │
 * │  3. Detect bot protection level                       │
 * │  4. Find and follow "Add to Cart" path                │
 * │  5. Walk checkout: shipping → payment → confirm       │
 * │  6. Record each step as a TraceStep                   │
 * │  7. Build SiteProfile from the trace                  │
 * │                                                       │
 * │  Dry-run: stops before submitting payment             │
 * └──────────────────────────────────────────────────────┘
 */

import type { ShippingInfo } from "@bloon/core";
import type { TraceStep, WalkerTrace } from "./profile-builder.js";
import type { FetchResult, SessionState, PageSnapshot } from "./types.js";
import { createSessionState } from "./session-manager.js";
import { fetchPage } from "./page-fetcher.js";
import { scoreSpa } from "./spa-scorer.js";
import { parseHTML } from "./page-parser.js";
import { classifyPage } from "./page-classifier.js";
import { detectPlatform } from "./platform-detector.js";
import { detectBotProtection } from "./bot-detector.js";
import { mapFields } from "./field-mapper.js";
import { renderPage } from "./browser-renderer.js";

// ---- Types ----

export interface WalkerInput {
  readonly productUrl: string;
  readonly shipping: ShippingInfo;
  readonly dryRun?: boolean;
}

export interface WalkerResult {
  readonly success: boolean;
  readonly trace?: WalkerTrace;
  readonly errorMessage?: string;
  readonly stepsCompleted: number;
}

// ---- Constants ----

const MAX_WALKER_STEPS = 15;
const PAYMENT_PAGE_TYPES = new Set([
  "payment-form",
  "payment-gateway",
]);
const STOP_PAGE_TYPES = new Set([
  "confirmation",
  "error",
]);

// ---- Helpers ----

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function findAddToCartUrl(snapshot: PageSnapshot, baseUrl: string): string | null {
  // Check forms with action containing "cart/add" or "cart"
  for (const form of snapshot.forms) {
    if (
      form.action.includes("/cart/add") ||
      form.action.includes("/cart")
    ) {
      if (form.action.startsWith("http")) return form.action;
      try {
        return new URL(form.action, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }

  // Check links with checkout or cart paths
  for (const link of snapshot.links) {
    const href = link.href.toLowerCase();
    if (href.includes("/cart/add") || href.includes("add-to-cart")) {
      if (link.href.startsWith("http")) return link.href;
      try {
        return new URL(link.href, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }

  return null;
}

function findCheckoutUrl(snapshot: PageSnapshot, baseUrl: string): string | null {
  // Check links for /checkout
  for (const link of snapshot.links) {
    const href = link.href.toLowerCase();
    if (href.includes("/checkout") && !href.includes("/cart")) {
      if (link.href.startsWith("http")) return link.href;
      try {
        return new URL(link.href, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }

  // Check forms with checkout action
  for (const form of snapshot.forms) {
    if (form.action.toLowerCase().includes("checkout")) {
      if (form.action.startsWith("http")) return form.action;
      try {
        return new URL(form.action, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }

  return null;
}

function buildFormBody(
  snapshot: PageSnapshot,
  shipping: ShippingInfo,
): { body: string; contentType: string } | null {
  if (snapshot.forms.length === 0) return null;

  const form = snapshot.forms[0]!;
  const params = new URLSearchParams();

  // Copy hidden inputs
  for (const [key, value] of Object.entries(snapshot.hiddenInputs)) {
    params.set(key, value);
  }

  // Map fields using field-mapper
  const mappings = mapFields(form.fields);

  for (const mapping of mappings) {
    const value = resolveStandardField(mapping.standardField, shipping);
    if (value) {
      params.set(mapping.siteField, value);
    }
  }

  // Also set any form fields that didn't get mapped but have known names
  for (const field of form.fields) {
    if (field.type === "hidden") continue;
    if (params.has(field.name)) continue;

    const nameLower = field.name.toLowerCase();
    if (nameLower.includes("email")) {
      params.set(field.name, shipping.email);
    } else if (nameLower.includes("first") && nameLower.includes("name")) {
      params.set(field.name, shipping.name.split(" ")[0] ?? shipping.name);
    } else if (nameLower.includes("last") && nameLower.includes("name")) {
      params.set(field.name, shipping.name.split(" ").slice(1).join(" ") || shipping.name);
    } else if (nameLower.includes("address") || nameLower.includes("street") || nameLower.includes("line1")) {
      params.set(field.name, shipping.street);
    } else if (nameLower.includes("city")) {
      params.set(field.name, shipping.city);
    } else if (nameLower.includes("state") || nameLower.includes("province")) {
      params.set(field.name, shipping.state);
    } else if (nameLower.includes("zip") || nameLower.includes("postal")) {
      params.set(field.name, shipping.zip);
    } else if (nameLower.includes("country")) {
      params.set(field.name, shipping.country);
    } else if (nameLower.includes("phone") || nameLower.includes("tel")) {
      params.set(field.name, shipping.phone);
    }
  }

  if (params.toString().length === 0) return null;

  return {
    body: params.toString(),
    contentType: "application/x-www-form-urlencoded",
  };
}

function resolveStandardField(
  standardField: string,
  shipping: ShippingInfo,
): string | null {
  switch (standardField) {
    case "shipping.email":
      return shipping.email;
    case "shipping.name":
      return shipping.name;
    case "shipping.firstName":
      return shipping.name.split(" ")[0] ?? shipping.name;
    case "shipping.lastName":
      return shipping.name.split(" ").slice(1).join(" ") || shipping.name;
    case "shipping.street":
      return shipping.street;
    case "shipping.apartment":
      return shipping.apartment ?? "";
    case "shipping.city":
      return shipping.city;
    case "shipping.state":
      return shipping.state;
    case "shipping.zip":
      return shipping.zip;
    case "shipping.country":
      return shipping.country;
    case "shipping.phone":
      return shipping.phone;
    default:
      return null;
  }
}

function extractValuesFromFetchResult(
  fetchResult: FetchResult,
  snapshot: PageSnapshot,
): Record<string, string> {
  const values: Record<string, string> = {};

  // Extract hidden inputs as potential tokens
  for (const [key, value] of Object.entries(snapshot.hiddenInputs)) {
    if (value && (key.toLowerCase().includes("token") || key.toLowerCase().includes("csrf"))) {
      values[key] = value;
    }
  }

  // Extract Stripe publishable keys
  for (const key of snapshot.stripeKeys) {
    values["stripe_pk"] = key;
  }

  // Try to extract values from JSON responses
  if (fetchResult.contentType.includes("application/json")) {
    try {
      const json = JSON.parse(fetchResult.body) as Record<string, unknown>;
      for (const [key, val] of Object.entries(json)) {
        if (typeof val === "string" && val.length < 200) {
          values[key] = val;
        } else if (typeof val === "number") {
          values[key] = String(val);
        }
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return values;
}

// ---- Main walker ----

/**
 * Walk a checkout funnel stage-by-stage, recording every request/response.
 *
 * Algorithm:
 * 1. Fetch the product page (HTTP first, browser render if SPA)
 * 2. Detect platform and bot protection
 * 3. Find add-to-cart path → follow it
 * 4. Find checkout path → follow it
 * 5. At each checkout step: classify page, fill form, submit, record
 * 6. Stop at payment page (dry-run) or confirmation page
 *
 * @param input - Product URL, shipping info, and dry-run flag
 * @returns Walker result with trace and step count
 */
export async function walkCheckoutFlow(
  input: WalkerInput,
): Promise<WalkerResult> {
  const { productUrl, shipping, dryRun = true } = input;
  const domain = extractDomain(productUrl);
  const steps: TraceStep[] = [];
  let session: SessionState = createSessionState();
  let stripePublishableKey: string | undefined;

  try {
    // ---- Step 1: Fetch product page ----

    let productFetch: FetchResult;
    let productSnapshot: PageSnapshot;

    try {
      const httpResult = await fetchPage(productUrl, session, { timeoutMs: 20_000 });
      session = httpResult.updatedSession;
      productFetch = httpResult.fetchResult;
      productSnapshot = parseHTML(productFetch.body, productFetch.finalUrl);

      // Check if page needs JS rendering
      const spaScore = scoreSpa(productFetch.body);
      if (!spaScore.isServerRendered) {
        // Try browser rendering
        try {
          const rendered = await renderPage(productUrl);
          productFetch = {
            ...productFetch,
            body: rendered.html,
            finalUrl: rendered.finalUrl,
          };
          productSnapshot = parseHTML(rendered.html, rendered.finalUrl);
        } catch {
          // Browser rendering failed — continue with HTTP HTML
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      return {
        success: false,
        errorMessage: `Failed to fetch product page: ${message}`,
        stepsCompleted: 0,
      };
    }

    // Record product page step
    const productValues = extractValuesFromFetchResult(productFetch, productSnapshot);
    if (productSnapshot.stripeKeys.length > 0) {
      stripePublishableKey = productSnapshot.stripeKeys[0];
    }

    steps.push({
      url: productUrl,
      method: "GET",
      requestHeaders: {},
      responseStatus: productFetch.statusCode,
      responseHeaders: productFetch.headers,
      responseBody: productFetch.body.slice(0, 50_000), // Cap body size
      responseContentType: productFetch.contentType,
      setCookies: [...productFetch.setCookies],
      redirectChain: [...productFetch.redirectChain],
      pageType: classifyPage(productSnapshot).pageType,
      extractedValues: productValues,
    });

    // ---- Step 2: Detect platform + bot protection ----

    const platform = detectPlatform(productFetch, productSnapshot);
    const botProtection = detectBotProtection(productFetch);

    // ---- Step 3: Find and follow add-to-cart ----

    const addToCartUrl = findAddToCartUrl(productSnapshot, productFetch.finalUrl);
    if (addToCartUrl) {
      try {
        const cartResult = await fetchPage(addToCartUrl, session, {
          method: "POST",
          timeoutMs: 15_000,
        });
        session = cartResult.updatedSession;
        const cartFetch = cartResult.fetchResult;
        const cartSnapshot = parseHTML(cartFetch.body, cartFetch.finalUrl);
        const cartValues = extractValuesFromFetchResult(cartFetch, cartSnapshot);

        steps.push({
          url: addToCartUrl,
          method: "POST",
          requestHeaders: {},
          responseStatus: cartFetch.statusCode,
          responseHeaders: cartFetch.headers,
          responseBody: cartFetch.body.slice(0, 50_000),
          responseContentType: cartFetch.contentType,
          setCookies: [...cartFetch.setCookies],
          redirectChain: [...cartFetch.redirectChain],
          pageType: classifyPage(cartSnapshot).pageType,
          extractedValues: cartValues,
        });
      } catch {
        // Add-to-cart failed — try to continue to checkout directly
      }
    }

    // ---- Step 4: Find and follow checkout ----

    // Re-fetch if we need to find the checkout URL from the current page
    let currentUrl = productFetch.finalUrl;
    let currentSnapshot = productSnapshot;

    // If we added to cart, we might be on a cart page now
    if (steps.length > 1) {
      const lastStep = steps[steps.length - 1]!;
      currentUrl = lastStep.url;
      currentSnapshot = parseHTML(lastStep.responseBody, currentUrl);
    }

    const checkoutUrl = findCheckoutUrl(currentSnapshot, currentUrl);

    if (checkoutUrl) {
      try {
        const checkoutResult = await fetchPage(checkoutUrl, session, { timeoutMs: 20_000 });
        session = checkoutResult.updatedSession;
        let checkoutFetch = checkoutResult.fetchResult;
        let checkoutSnapshot = parseHTML(checkoutFetch.body, checkoutFetch.finalUrl);

        // Check if checkout page needs rendering
        const checkoutSpa = scoreSpa(checkoutFetch.body);
        if (!checkoutSpa.isServerRendered) {
          try {
            const rendered = await renderPage(checkoutUrl);
            checkoutFetch = {
              ...checkoutFetch,
              body: rendered.html,
              finalUrl: rendered.finalUrl,
            };
            checkoutSnapshot = parseHTML(rendered.html, rendered.finalUrl);
          } catch {
            // Continue with HTTP response
          }
        }

        const checkoutValues = extractValuesFromFetchResult(checkoutFetch, checkoutSnapshot);
        if (checkoutSnapshot.stripeKeys.length > 0) {
          stripePublishableKey = checkoutSnapshot.stripeKeys[0];
        }

        steps.push({
          url: checkoutUrl,
          method: "GET",
          requestHeaders: {},
          responseStatus: checkoutFetch.statusCode,
          responseHeaders: checkoutFetch.headers,
          responseBody: checkoutFetch.body.slice(0, 50_000),
          responseContentType: checkoutFetch.contentType,
          setCookies: [...checkoutFetch.setCookies],
          redirectChain: [...checkoutFetch.redirectChain],
          pageType: classifyPage(checkoutSnapshot).pageType,
          extractedValues: checkoutValues,
        });

        // ---- Step 5: Walk checkout stages ----

        let walkUrl: string | undefined = checkoutFetch.finalUrl;
        let walkSnapshot = checkoutSnapshot;
        let stepCount = steps.length;

        while (stepCount < MAX_WALKER_STEPS && walkUrl) {
          const classification = classifyPage(walkSnapshot);

          // Stop conditions
          if (STOP_PAGE_TYPES.has(classification.pageType)) break;
          if (dryRun && PAYMENT_PAGE_TYPES.has(classification.pageType)) break;

          // Try to fill and submit the current form
          const formPayload = buildFormBody(walkSnapshot, shipping);
          if (!formPayload) break; // No form to submit

          // Find form action URL
          const formAction = walkSnapshot.forms[0]?.action;
          if (!formAction) break;

          const submitUrl = formAction.startsWith("http")
            ? formAction
            : new URL(formAction, walkUrl).toString();

          try {
            const submitResult = await fetchPage(submitUrl, session, {
              method: "POST",
              body: formPayload.body,
              contentType: formPayload.contentType,
              timeoutMs: 20_000,
            });
            session = submitResult.updatedSession;
            let submitFetch = submitResult.fetchResult;
            let submitSnapshot = parseHTML(submitFetch.body, submitFetch.finalUrl);

            // Render if needed
            const submitSpa = scoreSpa(submitFetch.body);
            if (!submitSpa.isServerRendered && submitFetch.statusCode < 300) {
              try {
                const rendered = await renderPage(submitFetch.finalUrl);
                submitFetch = {
                  ...submitFetch,
                  body: rendered.html,
                  finalUrl: rendered.finalUrl,
                };
                submitSnapshot = parseHTML(rendered.html, rendered.finalUrl);
              } catch {
                // Continue with HTTP
              }
            }

            const submitValues = extractValuesFromFetchResult(submitFetch, submitSnapshot);
            if (submitSnapshot.stripeKeys.length > 0) {
              stripePublishableKey = submitSnapshot.stripeKeys[0];
            }

            steps.push({
              url: submitUrl,
              method: "POST",
              requestHeaders: {},
              requestBody: formPayload.body,
              requestContentType: formPayload.contentType,
              responseStatus: submitFetch.statusCode,
              responseHeaders: submitFetch.headers,
              responseBody: submitFetch.body.slice(0, 50_000),
              responseContentType: submitFetch.contentType,
              setCookies: [...submitFetch.setCookies],
              redirectChain: [...submitFetch.redirectChain],
              pageType: classifyPage(submitSnapshot).pageType,
              extractedValues: submitValues,
            });

            // Move to next page
            walkUrl = submitFetch.finalUrl;
            walkSnapshot = submitSnapshot;
            stepCount = steps.length;
          } catch {
            // Form submission failed — stop walking
            break;
          }
        }
      } catch {
        // Checkout fetch failed — return what we have
      }
    }

    // ---- Build trace ----

    const trace: WalkerTrace = {
      domain,
      platform,
      botProtection,
      steps,
      ...(stripePublishableKey ? { stripePublishableKey } : {}),
    };

    return {
      success: steps.length >= 2,
      trace,
      stepsCompleted: steps.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown walker error";
    return {
      success: false,
      errorMessage: message,
      stepsCompleted: steps.length,
      ...(steps.length > 0
        ? {
            trace: {
              domain,
              platform: "unknown",
              botProtection: "none",
              steps,
            },
          }
        : {}),
    };
  }
}
