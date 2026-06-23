/**
 * Core flow execution loop for HTTP-only checkout.
 *
 * Takes a SiteProfile (the cached representation of a checkout flow)
 * and fires the endpoint chain as pure HTTP requests — zero LLM calls.
 *
 * The algorithm:
 *   1. Create fresh session
 *   2. For each EndpointStep: resolve URL, build payload, fetch, extract
 *   3. Handle Stripe steps via direct API (card data never hits LLM)
 *   4. On 401/403: restart from step 0 (once)
 *   5. On 429: wait and retry the failed step
 *   6. On stale signals: return immediately
 */

import type {
  SiteProfile,
  EndpointStep,
  ShippingInfo,
  CheckoutErrorCategory,
} from "@bloon/core";
import { getCardInfo } from "@bloon/core";
import type { ExecutionContext, FetchResult, StepResult } from "./types.js";
import { createSessionState, addCookiesFromHeaders } from "./session-manager.js";
import { fetchPage } from "./page-fetcher.js";
import type { FetchPageResult } from "./page-fetcher.js";
import { buildPayload } from "./payload-builder.js";
import { createPaymentMethod, confirmPaymentIntent } from "./stripe-client.js";
import { extractValue } from "./value-extractor.js";
import { compareFingerprints } from "./fingerprint.js";
import { analyzeError, analyzeNullExtraction } from "./error-handler.js";
import type { ErrorAnalysis, RecoveryAction } from "./error-handler.js";

// ---- Result types ----

export interface FlowExecutionResult {
  readonly success: boolean;
  readonly orderNumber?: string;
  readonly finalTotal?: string;
  readonly failedStep?: number;
  readonly errorMessage?: string;
  readonly errorCategory?: CheckoutErrorCategory;
  readonly context: ExecutionContext;
  readonly durationMs: number;
}

// ---- Constants ----

const MAX_RESTART_ATTEMPTS = 1;
const MAX_RETRY_ATTEMPTS = 2;
const FINGERPRINT_STALE_THRESHOLD = 0.7;

// ---- URL template resolution ----

/**
 * Replace {placeholder} tokens in a URL pattern with extracted values.
 * Returns null if any placeholder cannot be resolved.
 */
function resolveUrlTemplate(
  urlPattern: string,
  extractedValues: Readonly<Record<string, string>>,
): { readonly url: string } | { readonly missingPlaceholder: string } {
  const placeholderRegex = /\{([^}]+)\}/g;
  let result = urlPattern;
  let match: RegExpExecArray | null;

  // Reset regex state
  placeholderRegex.lastIndex = 0;

  // Determine query string boundary for encoding decisions
  const queryStart = urlPattern.indexOf("?");

  while ((match = placeholderRegex.exec(urlPattern)) !== null) {
    const placeholder = match[1]!;
    const value = extractedValues[placeholder];
    if (value === undefined) {
      return { missingPlaceholder: placeholder };
    }
    // Only URL-encode values in query string positions.
    // Path segment tokens (cart IDs, session tokens) should not be encoded.
    const inQuery = queryStart !== -1 && match.index > queryStart;
    const encoded = inQuery ? encodeURIComponent(value) : value;
    result = result.replace(`{${placeholder}}`, encoded);
  }

  return { url: result };
}

// ---- Stripe step handling ----

/**
 * Handle a Stripe-specific step (payment method creation or intent confirmation).
 */
async function executeStripeStep(
  step: EndpointStep,
  context: ExecutionContext,
  profile: SiteProfile,
): Promise<
  | { readonly success: true; readonly extractedValues: Readonly<Record<string, string>> }
  | { readonly success: false; readonly error: ErrorAnalysis }
> {
  const stripe = profile.stripe;
  if (!stripe) {
    return {
      success: false,
      error: {
        action: "mark_stale" as RecoveryAction,
        reason: "Stripe step found but no Stripe integration in profile",
      },
    };
  }

  const card = getCardInfo();

  // Step is a payment method creation (POST /v1/payment_methods)
  if (step.urlPattern.includes("/v1/payment_methods")) {
    const result = await createPaymentMethod(stripe.publishableKey, card);

    if ("error" in result) {
      // Determine if it's a card error or key error
      const errorAnalysis = analyzeError(
        400,
        result.error,
        {},
        `stripe.createPaymentMethod (step ${step.index})`,
      );
      return { success: false, error: errorAnalysis };
    }

    return {
      success: true,
      extractedValues: { payment_method_id: result.paymentMethodId },
    };
  }

  // Step is a payment intent confirmation
  if (step.urlPattern.includes("/v1/payment_intents")) {
    const clientSecret = context.extractedValues["client_secret"];
    const paymentMethodId = context.extractedValues["payment_method_id"];

    if (!clientSecret || !paymentMethodId) {
      return {
        success: false,
        error: {
          action: "mark_stale" as RecoveryAction,
          reason: "Missing client_secret or payment_method_id for intent confirmation",
        },
      };
    }

    const result = await confirmPaymentIntent(
      stripe.publishableKey,
      clientSecret,
      paymentMethodId,
    );

    if (!result.success) {
      const errorAnalysis = analyzeError(
        400,
        result.error ?? "",
        {},
        `stripe.confirmPaymentIntent (step ${step.index})`,
      );
      return { success: false, error: errorAnalysis };
    }

    return { success: true, extractedValues: {} };
  }

  return {
    success: false,
    error: {
      action: "mark_stale" as RecoveryAction,
      reason: `Unknown Stripe step URL pattern: ${step.urlPattern}`,
    },
  };
}

// ---- Single step execution ----

/**
 * Execute a single EndpointStep: build payload, fetch, validate, extract.
 */
async function executeStep(
  step: EndpointStep,
  context: ExecutionContext,
  shipping: ShippingInfo,
  profile: SiteProfile,
): Promise<
  | { readonly success: true; readonly context: ExecutionContext; readonly stepResult: StepResult }
  | { readonly success: false; readonly error: ErrorAnalysis }
> {
  const startMs = Date.now();

  // Resolve URL template
  const urlResolution = resolveUrlTemplate(step.urlPattern, context.extractedValues);
  if ("missingPlaceholder" in urlResolution) {
    return {
      success: false,
      error: analyzeNullExtraction(urlResolution.missingPlaceholder, step.index),
    };
  }

  const resolvedUrl = urlResolution.url;

  // Handle Stripe steps via direct API
  if (resolvedUrl.includes("api.stripe.com")) {
    const stripeResult = await executeStripeStep(step, context, profile);
    if (!stripeResult.success) {
      return { success: false, error: stripeResult.error };
    }

    const newExtractedValues = {
      ...context.extractedValues,
      ...stripeResult.extractedValues,
    };

    const durationMs = Date.now() - startMs;
    const stepResult: StepResult = {
      stepIndex: step.index,
      request: { url: resolvedUrl, method: step.method },
      response: {
        url: resolvedUrl,
        finalUrl: resolvedUrl,
        statusCode: 200,
        headers: {},
        body: "",
        contentType: "application/json",
        redirectChain: [],
        setCookies: [],
      },
      extractedValues: stripeResult.extractedValues,
      durationMs,
    };

    const newContext: ExecutionContext = {
      ...context,
      extractedValues: newExtractedValues,
      stepResults: [...context.stepResults, stepResult],
    };

    return { success: true, context: newContext, stepResult };
  }

  // Build payload for non-GET requests
  let body: string | undefined;
  let contentType: string | undefined;
  if (step.method !== "GET" && step.payload && step.payload.length > 0) {
    const rawCt = step.contentType ?? "application/json";
    // buildPayload only supports JSON and form-encoded; treat multipart as JSON
    const ct: "application/json" | "application/x-www-form-urlencoded" =
      rawCt === "application/x-www-form-urlencoded"
        ? "application/x-www-form-urlencoded"
        : "application/json";
    const payloadResult = buildPayload(step.payload, context, shipping, ct);

    if (payloadResult.missingFields.length > 0) {
      return {
        success: false,
        error: {
          action: "mark_stale",
          reason: `Missing payload fields: ${payloadResult.missingFields.join(", ")}`,
        },
      };
    }

    body = payloadResult.body;
    contentType = ct;
  }

  // Fetch the page
  let pageResult: FetchPageResult;
  try {
    pageResult = await fetchPage(resolvedUrl, context.session, {
      method: step.method,
      body,
      contentType,
      extraHeaders: step.headers,
      maxRedirects: step.maxRedirects,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    return {
      success: false,
      error: {
        action: "retry_with_backoff",
        reason: `Fetch failed at step ${step.index}: ${message}`,
      },
    };
  }

  const fetchResult = pageResult.fetchResult;
  let updatedSession = pageResult.updatedSession;

  // Check HTTP status for errors
  if (fetchResult.statusCode >= 400) {
    const errorAnalysis = analyzeError(
      fetchResult.statusCode,
      fetchResult.body,
      fetchResult.headers,
      `step ${step.index} (${step.description ?? step.urlPattern})`,
    );
    if (errorAnalysis.action !== "continue") {
      return { success: false, error: errorAnalysis };
    }
  }

  // Validate redirect chain if expected
  if (step.expectedRedirectChain && step.expectedRedirectChain.length > 0) {
    const actualDomains = fetchResult.redirectChain.map((r) => {
      try {
        return new URL(r.toUrl).hostname;
      } catch {
        return "";
      }
    });

    const expectedCount = step.expectedRedirectChain.length;
    const actualCount = actualDomains.length;
    if (actualCount !== expectedCount) {
      return {
        success: false,
        error: {
          action: "mark_stale",
          reason: `Redirect chain mismatch at step ${step.index}: expected ${expectedCount} redirects, got ${actualCount}`,
        },
      };
    }
  }

  // Validate response fingerprint
  if (step.fingerprint) {
    const similarity = compareFingerprints(step.fingerprint, fetchResult);
    if (similarity < FINGERPRINT_STALE_THRESHOLD) {
      return {
        success: false,
        error: {
          action: "mark_stale",
          reason: `Fingerprint mismatch at step ${step.index} (similarity: ${similarity.toFixed(2)})`,
        },
      };
    }
  }

  // Extract dynamic values
  const stepExtracted: Record<string, string> = {};
  if (step.extractions) {
    for (const extraction of step.extractions) {
      const value = extractValue(extraction.extraction, fetchResult);
      if (value === null) {
        const nullAnalysis = analyzeNullExtraction(extraction.name, step.index);
        return { success: false, error: nullAnalysis };
      }
      stepExtracted[extraction.name] = value;
    }
  }

  // Update session with response cookies
  updatedSession = addCookiesFromHeaders(
    updatedSession,
    fetchResult.setCookies,
    fetchResult.finalUrl,
  );

  const durationMs = Date.now() - startMs;
  const stepResult: StepResult = {
    stepIndex: step.index,
    request: { url: resolvedUrl, method: step.method, contentType },
    response: fetchResult,
    extractedValues: stepExtracted,
    durationMs,
  };

  const newContext: ExecutionContext = {
    session: updatedSession,
    extractedValues: { ...context.extractedValues, ...stepExtracted },
    stepResults: [...context.stepResults, stepResult],
  };

  return { success: true, context: newContext, stepResult };
}

// ---- Wait helper (for retry backoff) ----

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Handle step error with retry/restart logic ----

interface StepErrorHandlerResult {
  readonly action: "retry" | "restart" | "abort";
  readonly waitMs?: number;
  readonly error?: ErrorAnalysis;
}

function handleStepError(
  error: ErrorAnalysis,
  retryCount: number,
  restartCount: number,
): StepErrorHandlerResult {
  switch (error.action) {
    case "retry_with_backoff": {
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        return { action: "abort", error };
      }
      const baseDelay = error.retryAfterMs ?? 5_000;
      const backoffDelay = Math.min(baseDelay * Math.pow(2, retryCount), 30_000);
      return { action: "retry", waitMs: backoffDelay };
    }

    case "restart_flow": {
      if (restartCount >= MAX_RESTART_ATTEMPTS) {
        return { action: "abort", error };
      }
      return { action: "restart" };
    }

    case "mark_stale":
    case "abort":
      return { action: "abort", error };

    case "continue":
    default:
      return { action: "abort", error };
  }
}

// ---- Main execution loop ----

/**
 * Execute a full checkout flow as pure HTTP against a cached SiteProfile.
 *
 * Fires each EndpointStep in sequence, extracting dynamic values from
 * each response and injecting them into downstream requests. Stripe
 * steps bypass regular fetch and go directly to Stripe's API.
 *
 * @param profile - Cached site profile with the endpoint chain
 * @param shipping - User's shipping information for payload resolution
 * @returns Flow result with success/failure, order number, and diagnostics
 */
export async function executeFlow(
  profile: SiteProfile,
  shipping: ShippingInfo,
): Promise<FlowExecutionResult> {
  const flowStart = Date.now();
  let restartCount = 0;

  // Outer loop: supports restarting the entire flow on 401/403
  while (restartCount <= MAX_RESTART_ATTEMPTS) {
    let context: ExecutionContext = {
      session: createSessionState(),
      extractedValues: {},
      stepResults: [],
    };

    let flowFailed = false;
    let needsRestart = false;
    let failedStepIndex: number | undefined;
    let failureError: ErrorAnalysis | undefined;

    // Inner loop: step-by-step execution
    for (let i = 0; i < profile.endpoints.length; i++) {
      const step = profile.endpoints[i]!;
      let retryCount = 0;
      let stepSucceeded = false;

      // Retry loop for individual steps
      while (retryCount <= MAX_RETRY_ATTEMPTS && !stepSucceeded) {
        const result = await executeStep(step, context, shipping, profile);

        if (result.success) {
          context = result.context;
          stepSucceeded = true;
        } else {
          const handling = handleStepError(result.error, retryCount, restartCount);

          if (handling.action === "retry") {
            retryCount++;
            if (handling.waitMs) {
              await wait(handling.waitMs);
            }
            continue;
          }

          if (handling.action === "restart") {
            restartCount++;
            needsRestart = true;
            break;
          }

          // Abort
          failedStepIndex = step.index;
          failureError = handling.error ?? result.error;
          flowFailed = true;
          break;
        }
      }

      if (needsRestart || flowFailed) break;

      // If step exhausted retries without success
      if (!stepSucceeded) {
        failedStepIndex = step.index;
        failureError = {
          action: "abort",
          reason: `Step ${step.index} failed after ${retryCount} retries`,
        };
        flowFailed = true;
        break;
      }
    }

    // Restart the entire flow from step 0
    if (needsRestart) {
      continue;
    }

    const durationMs = Date.now() - flowStart;

    if (flowFailed) {
      return {
        success: false,
        failedStep: failedStepIndex,
        errorMessage: failureError?.reason,
        errorCategory: failureError?.errorCategory,
        context,
        durationMs,
      };
    }

    // Success — extract order number and total from last step
    const lastStepResult = context.stepResults[context.stepResults.length - 1];
    const orderNumber =
      context.extractedValues["order_number"] ??
      context.extractedValues["order_id"] ??
      context.extractedValues["confirmation_number"];
    const finalTotal =
      context.extractedValues["total"] ??
      context.extractedValues["order_total"] ??
      context.extractedValues["final_total"];

    return {
      success: true,
      orderNumber,
      finalTotal,
      context,
      durationMs,
    };
  }

  // Exhausted all restart attempts
  const durationMs = Date.now() - flowStart;
  return {
    success: false,
    errorMessage: "Flow failed after maximum restart attempts",
    errorCategory: "session_timeout",
    context: {
      session: createSessionState(),
      extractedValues: {},
      stepResults: [],
    },
    durationMs,
  };
}
