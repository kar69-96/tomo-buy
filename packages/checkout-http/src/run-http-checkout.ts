/**
 * Top-level entry point for the HTTP checkout engine.
 *
 * Called by the orchestrator when a cached SiteProfile exists for a domain.
 * This is the hot path: zero LLM calls, pure HTTP request replay.
 *
 * Flow:
 *   1. Extract domain from product URL
 *   2. Load cached SiteProfile
 *   3. Execute the endpoint chain via flow-executor
 *   4. On stale detection: invalidate profile, return failure
 *   5. Map result to HTTPCheckoutResult
 */

import type { Order, ShippingInfo, CheckoutErrorCategory } from "@bloon/core";
import { loadProfile, invalidateProfile } from "./profile-cache.js";
import { isProfileStale } from "./profile-cache.js";
import { executeFlow } from "./flow-executor.js";
import type { FlowExecutionResult } from "./flow-executor.js";

// ---- Input/Output types ----

export interface HTTPCheckoutInput {
  readonly order: Order;
  readonly shipping: ShippingInfo;
  readonly selections?: Readonly<Record<string, string>>;
}

export interface HTTPCheckoutResult {
  readonly success: boolean;
  readonly orderNumber?: string;
  readonly finalTotal?: string;
  readonly sessionId: string;
  readonly replayUrl: string;
  readonly failedStep?: string;
  readonly errorMessage?: string;
  readonly errorCategory?: CheckoutErrorCategory;
  readonly durationMs?: number;
  readonly engine: "http";
}

// ---- Helpers ----

/**
 * Extract the domain from a product URL.
 * Returns null if the URL is malformed.
 */
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Build an opaque replay identifier for the HTTP checkout result.
 * Does not expose filesystem paths to API consumers.
 */
function buildReplayUrl(domain: string): string {
  return `http-profile://${domain}`;
}

/**
 * Generate a unique session ID for this HTTP checkout attempt.
 * No Browserbase session — this is a purely local identifier.
 */
function buildSessionId(domain: string): string {
  return `http-${domain}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Map a FlowExecutionResult to the external HTTPCheckoutResult format.
 */
function mapFlowResult(
  flowResult: FlowExecutionResult,
  domain: string,
): HTTPCheckoutResult {
  if (flowResult.success) {
    return {
      success: true,
      orderNumber: flowResult.orderNumber,
      finalTotal: flowResult.finalTotal,
      sessionId: buildSessionId(domain),
      replayUrl: buildReplayUrl(domain),
      durationMs: flowResult.durationMs,
      engine: "http",
    };
  }

  return {
    success: false,
    failedStep:
      flowResult.failedStep !== undefined
        ? `step_${flowResult.failedStep}`
        : undefined,
    errorMessage: flowResult.errorMessage,
    errorCategory: flowResult.errorCategory,
    sessionId: buildSessionId(domain),
    replayUrl: buildReplayUrl(domain),
    durationMs: flowResult.durationMs,
    engine: "http",
  };
}

// ---- Public API ----

/**
 * Run an HTTP-only checkout against a cached site profile.
 *
 * This is the zero-LLM hot path. If no profile exists or the profile
 * is stale, it returns immediately with a failure — the caller should
 * fall back to browser-based checkout and profile learning.
 *
 * @param input - Order, shipping info, and optional variant selections
 * @returns Checkout result with order confirmation or failure details
 */
export async function runHTTPCheckout(
  input: HTTPCheckoutInput,
): Promise<HTTPCheckoutResult> {
  const { order, shipping } = input;

  // Step 1: Extract domain
  const domain = extractDomain(order.product.url);
  if (!domain) {
    return {
      success: false,
      errorMessage: "Invalid product URL — cannot extract domain",
      errorCategory: "navigation_failed",
      sessionId: "http-unknown-domain",
      replayUrl: "",
      engine: "http",
    };
  }

  // Step 2: Load cached profile
  const profile = loadProfile(domain);
  if (!profile) {
    return {
      success: false,
      errorMessage: "no_profile",
      sessionId: buildSessionId(domain),
      replayUrl: buildReplayUrl(domain),
      engine: "http",
    };
  }

  // Step 3: Check staleness before executing
  if (isProfileStale(profile)) {
    invalidateProfile(domain);
    return {
      success: false,
      errorMessage: "no_profile",
      sessionId: buildSessionId(domain),
      replayUrl: buildReplayUrl(domain),
      engine: "http",
    };
  }

  // Step 4: Execute the flow
  let flowResult: FlowExecutionResult;
  try {
    flowResult = await executeFlow(profile, shipping);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown execution error";
    return {
      success: false,
      errorMessage: `Flow execution failed: ${message}`,
      errorCategory: "unknown",
      sessionId: buildSessionId(domain),
      replayUrl: buildReplayUrl(domain),
      engine: "http",
    };
  }

  // Step 5: Handle stale result — invalidate profile before returning
  const isStaleResult =
    !flowResult.success &&
    flowResult.errorMessage?.includes("stale") === true;
  const isMissingField =
    !flowResult.success &&
    flowResult.errorMessage?.includes("page structure changed") === true;

  if (isStaleResult || isMissingField) {
    invalidateProfile(domain);
  }

  // Step 6: Map and return
  return mapFlowResult(flowResult, domain);
}
