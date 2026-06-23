/**
 * HTTP checkout error analysis and recovery strategy.
 *
 * Categorizes HTTP errors from the flow executor and returns
 * a recovery action: retry, restart, mark profile stale, or abort.
 *
 * Error signals are checked in priority order:
 *   1. Stripe-specific errors (card_declined, invalid_api_key)
 *   2. HTTP status code patterns (401/403, 429, 404, 5xx)
 *   3. Body content signals (out of stock, sold out)
 */

import type { CheckoutErrorCategory } from "@bloon/core";

// ---- Types ----

export type RecoveryAction =
  | "restart_flow"
  | "retry_with_backoff"
  | "mark_stale"
  | "abort"
  | "continue";

export interface ErrorAnalysis {
  readonly action: RecoveryAction;
  readonly reason: string;
  readonly retryAfterMs?: number;
  readonly errorCategory?: CheckoutErrorCategory;
}

// ---- Constants ----

const DEFAULT_RETRY_MS = 5_000;
const MAX_RETRY_MS = 30_000;

const OUT_OF_STOCK_PATTERNS = [
  "out of stock",
  "sold out",
  "unavailable",
  "no longer available",
  "currently unavailable",
  "out-of-stock",
  "not available",
] as const;

const STRIPE_CARD_ERROR_PATTERNS = [
  "card_declined",
  "card_error",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "insufficient_funds",
  "processing_error",
] as const;

// ---- Helpers ----

/**
 * Parse the Retry-After header value into milliseconds.
 * Supports both seconds (integer) and HTTP-date formats.
 */
function parseRetryAfter(headers: Readonly<Record<string, string>>): number {
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (!raw) return DEFAULT_RETRY_MS;

  const seconds = parseInt(raw, 10);
  if (!isNaN(seconds)) {
    return Math.min(seconds * 1000, MAX_RETRY_MS);
  }

  // Try parsing as HTTP-date
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return Math.min(Math.max(delayMs, DEFAULT_RETRY_MS), MAX_RETRY_MS);
  }

  return DEFAULT_RETRY_MS;
}

/**
 * Check if the response body contains Stripe card error signals.
 */
function containsStripeCardError(body: string): boolean {
  const lower = body.toLowerCase();
  return STRIPE_CARD_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Check if the response body indicates a Stripe API key error.
 */
function containsStripeKeyError(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes("invalid_api_key") ||
    lower.includes("invalid api key") ||
    lower.includes("no such token")
  );
}

/**
 * Check if the response body contains out-of-stock signals.
 */
function containsOutOfStockSignal(body: string): boolean {
  const lower = body.toLowerCase();
  return OUT_OF_STOCK_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ---- Public API ----

/**
 * Analyze an HTTP error and determine the appropriate recovery strategy.
 *
 * @param statusCode - HTTP response status code
 * @param responseBody - Raw response body text
 * @param headers - Response headers (flat record)
 * @param context - Human-readable description of what step triggered the error
 * @returns ErrorAnalysis with action, reason, and optional retry delay
 */
export function analyzeError(
  statusCode: number,
  responseBody: string,
  headers: Readonly<Record<string, string>>,
  context: string,
): ErrorAnalysis {
  // Priority 1: Stripe card errors in body (regardless of status code)
  if (containsStripeCardError(responseBody)) {
    return {
      action: "abort",
      reason: `Payment declined at ${context}`,
      errorCategory: "payment_rejected",
    };
  }

  // Priority 2: Stripe API key rotation
  if (containsStripeKeyError(responseBody)) {
    return {
      action: "mark_stale",
      reason: `Stripe publishable key invalid at ${context} — profile needs re-learning`,
    };
  }

  // Priority 3: Out of stock signals
  if (containsOutOfStockSignal(responseBody)) {
    return {
      action: "abort",
      reason: `Product unavailable at ${context}`,
      errorCategory: "navigation_failed",
    };
  }

  // Priority 4: HTTP status code patterns
  if (statusCode === 401 || statusCode === 403) {
    return {
      action: "restart_flow",
      reason: `Session expired or forbidden (${statusCode}) at ${context}`,
      errorCategory: "session_timeout",
    };
  }

  if (statusCode === 429) {
    const retryAfterMs = parseRetryAfter(headers);
    return {
      action: "retry_with_backoff",
      reason: `Rate limited (429) at ${context}`,
      retryAfterMs,
    };
  }

  if (statusCode === 404) {
    return {
      action: "mark_stale",
      reason: `Endpoint not found (404) at ${context} — profile needs re-learning`,
    };
  }

  if (statusCode >= 500) {
    return {
      action: "retry_with_backoff",
      reason: `Server error (${statusCode}) at ${context}`,
      retryAfterMs: DEFAULT_RETRY_MS,
    };
  }

  // Default: let the caller decide
  return {
    action: "continue",
    reason: `Non-critical status (${statusCode}) at ${context}`,
  };
}

/**
 * Analyze a null extraction — always indicates the profile is stale.
 *
 * When an expected dynamic value cannot be extracted from a step's response,
 * it means the page structure has changed since the profile was learned.
 *
 * @param valueName - Name of the value that could not be extracted
 * @param stepIndex - Which step produced the unextractable response
 * @returns ErrorAnalysis with mark_stale action
 */
export function analyzeNullExtraction(
  valueName: string,
  stepIndex: number,
): ErrorAnalysis {
  return {
    action: "mark_stale",
    reason: `Failed to extract "${valueName}" from step ${stepIndex} — page structure changed`,
  };
}
