/**
 * Classify a PageSnapshot into a PageType with confidence score.
 *
 * Uses shared classification signals from @bloon/core. Works on
 * the cheerio-parsed PageSnapshot (no DOM access). Each rule checks
 * text content, form fields, buttons, URLs, and selectors against
 * known signal arrays.
 *
 * Classification order matches the Stagehand classifier:
 *   donation-landing > confirmation > product > payment-form >
 *   payment-gateway > login-gate > shipping-form >
 *   email-verification > cart > error > unknown
 *
 * Pure function -- no side effects, no network calls.
 */

import type { PageType } from "@bloon/core";
import {
  CONFIRMATION_TEXT_SIGNALS,
  CONFIRMATION_URL_PATTERNS,
  ALL_ERROR_TEXT_SIGNALS,
  LOGIN_TEXT_SIGNALS,
  CART_TEXT_SIGNALS,
  SHIPPING_FIELD_SELECTORS,
  CARD_SELECTORS,
  ADD_TO_CART_SELECTORS,
  ADD_TO_CART_TEXT_SIGNALS,
  DONATION_TEXT_SIGNALS,
  PAYMENT_IFRAME_SELECTORS,
  VERIFICATION_TEXT_SIGNALS,
  CHECKOUT_BUTTON_SELECTOR,
} from "@bloon/core";
import type { PageSnapshot } from "./types.js";

// ---- Classification result ----

export interface ClassificationResult {
  readonly pageType: PageType;
  readonly confidence: number;
}

// ---- Helpers ----

/**
 * Count how many signal strings appear in the text (case-insensitive).
 */
function countTextMatches(
  text: string,
  signals: readonly string[],
): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const signal of signals) {
    if (lower.includes(signal.toLowerCase())) {
      count++;
    }
  }
  return count;
}

/**
 * Build a combined visible text string from the snapshot.
 * Includes title, button text, link text, and form field placeholders.
 */
function getVisibleText(snapshot: PageSnapshot): string {
  const parts: string[] = [snapshot.title];

  for (const button of snapshot.buttons) {
    parts.push(button.text);
  }

  for (const link of snapshot.links) {
    parts.push(link.text);
  }

  for (const form of snapshot.forms) {
    for (const field of form.fields) {
      if (field.placeholder) parts.push(field.placeholder);
    }
  }

  return parts.join(" ");
}

/**
 * Check if any form field names match patterns from a CSS selector string.
 * Since we don't have DOM access, we parse selector attribute patterns and
 * match against form field properties.
 */
function hasFieldMatchingSelectors(
  snapshot: PageSnapshot,
  selectorString: string,
): boolean {
  // Extract attribute patterns from CSS selectors
  // e.g., 'input[name*="cardnumber" i]' -> match field.name containing "cardnumber"
  const patterns = extractAttributePatterns(selectorString);

  for (const form of snapshot.forms) {
    for (const field of form.fields) {
      for (const pattern of patterns) {
        if (fieldMatchesPattern(field, pattern)) return true;
      }
    }
  }

  return false;
}

interface AttributePattern {
  readonly attr: string;
  readonly op: string; // "*=" (contains), "=" (exact), "^=" (starts with)
  readonly value: string;
}

/**
 * Parse CSS attribute selectors into structured patterns.
 * Handles: [attr*="val" i], [attr="val"], [attr^="val"]
 */
function extractAttributePatterns(selectorString: string): readonly AttributePattern[] {
  const patterns: AttributePattern[] = [];
  // Match [attr*="value" i] or [attr="value"] etc.
  const regex = /\[(\w+)(\*=|=|\^=)"([^"]+)"(?:\s+i)?\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(selectorString)) !== null) {
    patterns.push({
      attr: match[1]!,
      op: match[2]!,
      value: match[3]!.toLowerCase(),
    });
  }

  return patterns;
}

/**
 * Check if a form field matches an attribute pattern.
 */
function fieldMatchesPattern(
  field: { readonly name: string; readonly type: string; readonly placeholder?: string; readonly autocomplete?: string },
  pattern: AttributePattern,
): boolean {
  let fieldValue: string | undefined;

  switch (pattern.attr) {
    case "name":
      fieldValue = field.name;
      break;
    case "type":
      fieldValue = field.type;
      break;
    case "placeholder":
      fieldValue = field.placeholder;
      break;
    case "autocomplete":
      fieldValue = field.autocomplete;
      break;
    default:
      return false;
  }

  if (fieldValue === undefined) return false;
  const lower = fieldValue.toLowerCase();

  switch (pattern.op) {
    case "*=":
      return lower.includes(pattern.value);
    case "=":
      return lower === pattern.value;
    case "^=":
      return lower.startsWith(pattern.value);
    default:
      return false;
  }
}

/**
 * Check if snapshot has buttons matching CSS-selector-based patterns.
 * Extracts class/id/attribute patterns and checks button selectors.
 */
function hasButtonMatchingSelector(
  snapshot: PageSnapshot,
  selectorString: string,
): boolean {
  // Check button text against the selector string for keywords
  // Parse selectors for class patterns like [class*="add-to-cart"]
  const classPatterns: string[] = [];
  const classRegex = /\[class\*="([^"]+)"\s*i?\]/g;
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(selectorString)) !== null) {
    classPatterns.push(match[1]!.toLowerCase());
  }

  for (const button of snapshot.buttons) {
    const selectorLower = button.selector.toLowerCase();
    for (const pattern of classPatterns) {
      if (selectorLower.includes(pattern)) return true;
    }
  }

  return false;
}

/**
 * Check if URL matches any of the given patterns.
 */
function urlMatchesAny(url: string, patterns: readonly string[]): boolean {
  const lower = url.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Check if any link hrefs match any of the given patterns.
 */
function hasLinkMatching(snapshot: PageSnapshot, patterns: readonly string[]): boolean {
  for (const link of snapshot.links) {
    const lower = link.href.toLowerCase();
    if (patterns.some((p) => lower.includes(p.toLowerCase()))) return true;
  }
  return false;
}

/**
 * Check for iframe-based payment selectors by looking at script sources
 * and inline configs for payment gateway indicators.
 */
function hasPaymentIframeSignals(snapshot: PageSnapshot): boolean {
  // Parse the iframe selector for src patterns
  // PAYMENT_IFRAME_SELECTORS: 'iframe[src*="pay" i], iframe[src*="card" i], ...'
  const srcPatterns = ["pay", "card", "adyen", "stripe", "braintree"];

  // Check script sources for payment gateway indicators
  for (const src of snapshot.scriptSrcs) {
    const lower = src.toLowerCase();
    for (const pattern of srcPatterns) {
      if (lower.includes(pattern)) return true;
    }
  }

  // Check stripe keys as a strong indicator
  if (snapshot.stripeKeys.length > 0) return true;

  return false;
}

/**
 * Check if OTP-like inputs exist (short maxlength, code/otp names).
 */
function hasOtpInputs(snapshot: PageSnapshot): boolean {
  for (const form of snapshot.forms) {
    for (const field of form.fields) {
      const nameLower = field.name.toLowerCase();
      if (
        nameLower.includes("code") ||
        nameLower.includes("otp") ||
        nameLower.includes("verification") ||
        nameLower.includes("token")
      ) {
        return true;
      }
      if (
        field.autocomplete === "one-time-code"
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if donation amounts exist (inputs with amount-related names).
 */
function hasDonationAmounts(snapshot: PageSnapshot): boolean {
  for (const form of snapshot.forms) {
    for (const field of form.fields) {
      const nameLower = field.name.toLowerCase();
      if (nameLower.includes("amount") || nameLower.includes("donation")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if donate button exists.
 */
function hasDonateButton(snapshot: PageSnapshot): boolean {
  for (const button of snapshot.buttons) {
    if (button.text.toLowerCase().includes("donate")) return true;
  }
  for (const link of snapshot.links) {
    if (link.href.toLowerCase().includes("donate")) return true;
  }
  return false;
}

/**
 * Compute confidence from match count and max possible.
 * Returns 0.0-1.0, scaled so 1 match = 0.4, 2 = 0.6, 3+ = 0.8+.
 */
function computeConfidence(matchCount: number, maxExpected: number): number {
  if (matchCount <= 0) return 0;
  const base = Math.min(matchCount / maxExpected, 1.0);
  return Math.min(0.3 + base * 0.7, 1.0);
}

/**
 * Check if the URL looks like a checkout URL.
 */
function isCheckoutUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("/checkout") || lower.includes("/pay");
}

/**
 * Check if the URL looks like a login URL.
 */
function isLoginUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/signin") ||
    lower.includes("/sign-in") ||
    lower.includes("/account") ||
    lower.includes("/auth")
  );
}

/**
 * Count form fields matching shipping field selector patterns.
 */
function countShippingFieldMatches(snapshot: PageSnapshot): number {
  let count = 0;
  const allSelectors = SHIPPING_FIELD_SELECTORS.join(", ");
  const patterns = extractAttributePatterns(allSelectors);

  for (const form of snapshot.forms) {
    for (const field of form.fields) {
      for (const pattern of patterns) {
        if (fieldMatchesPattern(field, pattern)) {
          count++;
          break; // Count each field at most once
        }
      }
    }
  }
  return count;
}

// ---- Main classifier ----

/**
 * Classify a PageSnapshot into a PageType with confidence score.
 *
 * @param snapshot - Parsed page data from parseHTML()
 * @returns Classification result with pageType and confidence (0-1)
 */
export function classifyPage(snapshot: PageSnapshot): ClassificationResult {
  const visibleText = getVisibleText(snapshot);
  const allCardSelectors = CARD_SELECTORS.join(", ");

  // ---- 1. Donation landing ----
  const donationTextMatches = countTextMatches(visibleText, DONATION_TEXT_SIGNALS);
  const hasDonateBtn = hasDonateButton(snapshot);
  const hasDonationAmts = hasDonationAmounts(snapshot);

  if (donationTextMatches >= 2 && (hasDonateBtn || hasDonationAmts)) {
    // But if card field selectors match, it's a payment-gateway
    if (hasFieldMatchingSelectors(snapshot, allCardSelectors)) {
      return {
        pageType: "payment-gateway",
        confidence: computeConfidence(donationTextMatches + 1, 5),
      };
    }
    return {
      pageType: "donation-landing",
      confidence: computeConfidence(donationTextMatches, 4),
    };
  }

  // ---- 2. Confirmation ----
  const confirmTextMatches = countTextMatches(visibleText, CONFIRMATION_TEXT_SIGNALS);
  const urlMatchesConfirm = urlMatchesAny(snapshot.url, CONFIRMATION_URL_PATTERNS);
  const errorTextMatches = countTextMatches(visibleText, ALL_ERROR_TEXT_SIGNALS);

  if (confirmTextMatches >= 2 || (confirmTextMatches >= 1 && urlMatchesConfirm)) {
    // Check for error signals -- if errors present, fall through
    if (errorTextMatches === 0) {
      const matchCount = confirmTextMatches + (urlMatchesConfirm ? 1 : 0);
      return {
        pageType: "confirmation",
        confidence: computeConfidence(matchCount, 4),
      };
    }
  }

  // ---- 3. Product ----
  const hasAddToCartText = countTextMatches(visibleText, ADD_TO_CART_TEXT_SIGNALS) > 0;
  const hasAddToCartBtn = hasButtonMatchingSelector(snapshot, ADD_TO_CART_SELECTORS);
  const hasAddToCartLink = hasLinkMatching(snapshot, ["/cart/add", "add-to-cart"]);
  const isCheckout = isCheckoutUrl(snapshot.url);

  if ((hasAddToCartText || hasAddToCartBtn || hasAddToCartLink) && !isCheckout) {
    const matchCount = (hasAddToCartText ? 1 : 0) + (hasAddToCartBtn ? 1 : 0) + (hasAddToCartLink ? 1 : 0);
    return {
      pageType: "product",
      confidence: computeConfidence(matchCount, 3),
    };
  }

  // ---- 4. Payment form (card fields in page) ----
  if (hasFieldMatchingSelectors(snapshot, allCardSelectors)) {
    return {
      pageType: "payment-form",
      confidence: 0.85,
    };
  }

  // ---- 5. Payment gateway (iframes) ----
  if (hasPaymentIframeSignals(snapshot)) {
    return {
      pageType: "payment-gateway",
      confidence: 0.7,
    };
  }

  // ---- 6. Login gate ----
  const loginTextMatches = countTextMatches(visibleText, LOGIN_TEXT_SIGNALS);
  const isLoginOrCheckout = isLoginUrl(snapshot.url) || isCheckoutUrl(snapshot.url);

  if (loginTextMatches >= 2 && isLoginOrCheckout) {
    return {
      pageType: "login-gate",
      confidence: computeConfidence(loginTextMatches, 5),
    };
  }

  // ---- 7. Shipping form ----
  const shippingFieldMatches = countShippingFieldMatches(snapshot);

  if (shippingFieldMatches >= 2 || (shippingFieldMatches >= 1 && isCheckoutUrl(snapshot.url))) {
    const matchCount = shippingFieldMatches + (isCheckoutUrl(snapshot.url) ? 1 : 0);
    return {
      pageType: "shipping-form",
      confidence: computeConfidence(matchCount, 5),
    };
  }

  // ---- 8. Email verification ----
  const verificationTextMatches = countTextMatches(visibleText, VERIFICATION_TEXT_SIGNALS);

  if (verificationTextMatches >= 1 && hasOtpInputs(snapshot)) {
    return {
      pageType: "email-verification",
      confidence: computeConfidence(verificationTextMatches + 1, 4),
    };
  }

  // ---- 9. Cart ----
  const cartTextMatches = countTextMatches(visibleText, CART_TEXT_SIGNALS);
  const hasCheckoutBtn = hasButtonMatchingSelector(snapshot, CHECKOUT_BUTTON_SELECTOR);
  const hasCheckoutLink = hasLinkMatching(snapshot, ["/checkout"]);
  const urlHasCart = snapshot.url.toLowerCase().includes("/cart");

  if ((cartTextMatches >= 1 && (hasCheckoutBtn || hasCheckoutLink)) || urlHasCart) {
    const matchCount = cartTextMatches + (hasCheckoutBtn ? 1 : 0) + (urlHasCart ? 1 : 0);
    return {
      pageType: "cart",
      confidence: computeConfidence(matchCount, 4),
    };
  }

  // ---- 10. Error ----
  if (errorTextMatches >= 1) {
    return {
      pageType: "error",
      confidence: computeConfidence(errorTextMatches, 3),
    };
  }

  // ---- 11. Unknown ----
  return {
    pageType: "unknown",
    confidence: 0,
  };
}
