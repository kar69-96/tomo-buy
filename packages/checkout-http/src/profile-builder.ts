/**
 * Convert a recorded HTTP request/response trace into a SiteProfile.
 *
 * Analyzes the trace to identify dynamic values, extraction sources,
 * fingerprints, and token locations. The output SiteProfile can be
 * replayed by the Flow Executor as pure HTTP.
 */

import type {
  SiteProfile,
  PlatformType,
  BotProtectionLevel,
  EndpointStep,
  DynamicValue,
  HttpMethod,
  PageType,
} from "@bloon/core";
import { DEFAULT_PROFILE_TTL_MS } from "@bloon/core";
import { generateFingerprint } from "./fingerprint.js";
import type { FetchResult } from "./types.js";

export interface WalkerTrace {
  readonly domain: string;
  readonly platform: PlatformType;
  readonly botProtection: BotProtectionLevel;
  readonly steps: readonly TraceStep[];
  readonly stripePublishableKey?: string;
}

export interface TraceStep {
  readonly url: string;
  readonly method: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly requestBody?: string;
  readonly requestContentType?: string;
  readonly responseStatus: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBody: string;
  readonly responseContentType: string;
  readonly setCookies: readonly string[];
  readonly redirectChain: readonly { fromUrl: string; toUrl: string; statusCode: number }[];
  readonly pageType: string;
  readonly extractedValues: Readonly<Record<string, string>>;
}

// ---- Content type helpers ----

const METHODS_WITH_BODY: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

type EndpointContentType = "application/json" | "application/x-www-form-urlencoded" | "multipart/form-data";

/**
 * Map a raw content type string to one of the allowed EndpointStep content types.
 * Returns undefined if no match.
 */
function normalizeContentType(raw: string | undefined): EndpointContentType | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("application/json")) return "application/json";
  if (lower.includes("urlencoded")) return "application/x-www-form-urlencoded";
  if (lower.includes("multipart/form-data")) return "multipart/form-data";
  return undefined;
}

/**
 * Extract the domain from a URL string. Returns the hostname or the
 * original string if parsing fails.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---- Extraction source inference ----

/**
 * Build a DynamicValue extraction entry for a single key/value pair
 * extracted from a trace step's response.
 */
function buildExtraction(
  key: string,
  stepIndex: number,
  responseContentType: string,
): DynamicValue {
  const ct = responseContentType.toLowerCase();

  if (ct.includes("application/json")) {
    return {
      name: key,
      sourceStep: stepIndex,
      extraction: { type: "json_path", path: key },
    };
  }

  if (ct.includes("text/html")) {
    return {
      name: key,
      sourceStep: stepIndex,
      extraction: {
        type: "css_selector",
        path: `input[name="${key}"]`,
        attribute: "value",
      },
    };
  }

  // Fallback: regex extraction
  return {
    name: key,
    sourceStep: stepIndex,
    extraction: {
      type: "regex",
      path: `${key}\\s*[=:]\\s*["']?([^"'\\s,]+)`,
    },
  };
}

// ---- FetchResult construction ----

/**
 * Build a minimal FetchResult from a TraceStep so that
 * `generateFingerprint` can produce a ResponseFingerprint.
 */
function traceStepToFetchResult(step: TraceStep): FetchResult {
  // Determine the final URL from the redirect chain (last toUrl) or the step URL itself
  const finalUrl =
    step.redirectChain.length > 0
      ? step.redirectChain[step.redirectChain.length - 1]!.toUrl
      : step.url;

  return {
    url: step.url,
    finalUrl,
    statusCode: step.responseStatus,
    headers: step.responseHeaders,
    body: step.responseBody,
    contentType: step.responseContentType,
    redirectChain: step.redirectChain,
    setCookies: step.setCookies,
  };
}

// ---- Main builder ----

/**
 * Convert a recorded HTTP request/response trace into a replayable SiteProfile.
 *
 * Each TraceStep becomes an EndpointStep with inferred extraction sources,
 * response fingerprints, and redirect chain metadata. The resulting profile
 * can be replayed by the Flow Executor as pure HTTP.
 *
 * @param trace - The recorded walker trace from a successful checkout flow
 * @returns An immutable SiteProfile ready for caching and replay
 */
export function buildProfile(trace: WalkerTrace): SiteProfile {
  const now = new Date().toISOString();

  // 1. Convert each trace step to an EndpointStep
  const endpoints: readonly EndpointStep[] = trace.steps.map(
    (step, index): EndpointStep => {
      const method = step.method.toUpperCase() as HttpMethod;

      // Build DynamicValue extractions from extractedValues
      const extractions: readonly DynamicValue[] = Object.keys(
        step.extractedValues,
      ).map((key) => buildExtraction(key, index, step.responseContentType));

      // Content type only relevant for methods with a body
      const contentType = METHODS_WITH_BODY.has(method)
        ? normalizeContentType(step.requestContentType)
        : undefined;

      // Generate response fingerprint
      const fingerprint = generateFingerprint(traceStepToFetchResult(step));

      // Map redirect chain to domain strings
      const expectedRedirectChain: readonly string[] =
        step.redirectChain.length > 0
          ? step.redirectChain.map((r) => extractDomain(r.toUrl))
          : [];

      return {
        index,
        method,
        urlPattern: step.url,
        ...(contentType !== undefined ? { contentType } : {}),
        payload: [],
        ...(extractions.length > 0 ? { extractions } : {}),
        fingerprint,
        ...(expectedRedirectChain.length > 0 ? { expectedRedirectChain } : {}),
        pageType: step.pageType as PageType,
      };
    },
  );

  // 2. Build page classifications: URL -> PageType
  const pageClassifications: Record<string, PageType> = {};
  for (const step of trace.steps) {
    pageClassifications[step.url] = step.pageType as PageType;
  }

  // 3. Staleness metadata
  const staleness = {
    baseTtlMs: DEFAULT_PROFILE_TTL_MS,
    currentTtlMs: DEFAULT_PROFILE_TTL_MS,
    invalidationCount: 0,
    lastValidatedAt: now,
  } as const;

  // 4. Stripe integration (if key present)
  const stripe = trace.stripePublishableKey
    ? ({
        confirmationType: "server_side" as const,
        publishableKey: trace.stripePublishableKey,
      })
    : undefined;

  // 5. Assemble the full profile
  return {
    domain: trace.domain,
    platform: trace.platform,
    botProtection: trace.botProtection,
    httpEligible: trace.botProtection === "none",
    endpoints,
    authFlow: { type: "guest", stepIndex: 0 },
    ...(stripe !== undefined ? { stripe } : {}),
    tokenLocations: [],
    fieldMappings: [],
    interstitials: [],
    pageClassifications,
    staleness,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
