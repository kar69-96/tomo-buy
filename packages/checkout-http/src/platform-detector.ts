/**
 * Detect e-commerce platform from HTTP response HTML/headers/cookies.
 *
 * Supports: Shopify, WooCommerce, BigCommerce, Magento, Custom, Unknown.
 * Pure function — no network calls.
 *
 * Detection order: Shopify → WooCommerce → BigCommerce → Magento → custom → unknown.
 * Returns the first match found.
 */

import type { PlatformType } from "@bloon/core";
import type { FetchResult, PageSnapshot } from "./types.js";

// ---- Helpers ----

/** Case-insensitive header lookup. */
function hasHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/** Check if body contains any of the given substrings (case-sensitive). */
function bodyContainsAny(body: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => body.includes(p));
}

/** Check if any script src contains a given substring. */
function scriptSrcContains(
  scriptSrcs: readonly string[],
  pattern: string,
): boolean {
  return scriptSrcs.some((src) => src.includes(pattern));
}

/** Check if any Set-Cookie value starts with (or contains a cookie name starting with) a prefix. */
function hasCookieStartingWith(
  setCookies: readonly string[],
  prefix: string,
): boolean {
  return setCookies.some((raw) => {
    // The cookie name is everything before the first '='
    const name = raw.split("=")[0]?.trim() ?? "";
    return name.startsWith(prefix);
  });
}

/** Check if any Set-Cookie value contains a substring anywhere. */
function hasCookieContaining(
  setCookies: readonly string[],
  pattern: string,
): boolean {
  return setCookies.some((raw) => {
    const name = raw.split("=")[0]?.trim() ?? "";
    return name.includes(pattern);
  });
}

// ---- Platform detectors ----

function isShopify(fetchResult: FetchResult, snapshot: PageSnapshot): boolean {
  const { headers, body, setCookies } = fetchResult;
  const { scriptSrcs } = snapshot;

  // Header signals
  if (hasHeader(headers, "x-shopid") || hasHeader(headers, "x-shardid")) {
    return true;
  }

  // Body signals
  if (
    bodyContainsAny(body, [
      "cdn.shopify.com",
      "Shopify.shop",
      "Shopify.routes",
      "myshopify.com",
    ])
  ) {
    return true;
  }

  // Script src signals
  if (scriptSrcContains(scriptSrcs, "cdn.shopify.com")) {
    return true;
  }

  // Cookie signals
  if (hasCookieStartingWith(setCookies, "_shopify")) {
    return true;
  }

  return false;
}

function isWooCommerce(
  fetchResult: FetchResult,
  snapshot: PageSnapshot,
): boolean {
  const { body, setCookies } = fetchResult;
  const { scriptSrcs } = snapshot;

  // Body signals
  if (bodyContainsAny(body, ["wc-ajax", "woocommerce"])) {
    return true;
  }

  // Body or script src contains plugin path
  if (
    body.includes("wp-content/plugins/woocommerce") ||
    scriptSrcContains(scriptSrcs, "wp-content/plugins/woocommerce")
  ) {
    return true;
  }

  // Cookie signals
  if (
    hasCookieStartingWith(setCookies, "wp_woocommerce") ||
    hasCookieContaining(setCookies, "woocommerce")
  ) {
    return true;
  }

  return false;
}

function isBigCommerce(
  fetchResult: FetchResult,
  snapshot: PageSnapshot,
): boolean {
  const { headers, body } = fetchResult;
  const { scriptSrcs } = snapshot;

  // Header signals
  if (hasHeader(headers, "x-bc-store-version")) {
    return true;
  }

  // Script src or body signals
  if (
    scriptSrcContains(scriptSrcs, "bigcommerce.com") ||
    body.includes("bigcommerce.com")
  ) {
    return true;
  }

  return false;
}

function isMagento(fetchResult: FetchResult): boolean {
  const { body, setCookies } = fetchResult;

  // Cookie signals
  if (
    hasCookieContaining(setCookies, "mage-cache-storage") ||
    hasCookieContaining(setCookies, "form_key")
  ) {
    return true;
  }

  // Body signals: require.config AND (Magento or mage/)
  if (
    body.includes("require.config") &&
    (body.includes("Magento") || body.includes("mage/"))
  ) {
    return true;
  }

  return false;
}

// ---- Main detector ----

/**
 * Detect the e-commerce platform from HTTP response headers, cookies,
 * HTML body, and script sources.
 *
 * @param fetchResult - HTTP response data (headers, body, cookies)
 * @param snapshot    - Parsed page data (script sources, forms, etc.)
 * @returns The detected PlatformType
 */
export function detectPlatform(
  fetchResult: FetchResult,
  snapshot: PageSnapshot,
): PlatformType {
  if (isShopify(fetchResult, snapshot)) return "shopify";
  if (isWooCommerce(fetchResult, snapshot)) return "woocommerce";
  if (isBigCommerce(fetchResult, snapshot)) return "bigcommerce";
  if (isMagento(fetchResult)) return "magento";

  // No known platform detected — return "unknown"
  return "unknown";
}
