/**
 * Bot protection detector — analyzes HTTP response headers and page
 * content to determine the level of bot protection on a site.
 *
 * Detection is purely signal-based (no network calls). Results feed
 * into the site profile's `botProtection` field, which the engine
 * selector uses to route protected domains to Stagehand.
 *
 * Protection levels:
 *   - "none"         -> Safe for pure HTTP checkout
 *   - "stealth"      -> Needs Browserbase stealth adapter (real fingerprint)
 *   - "full_browser" -> Needs full Stagehand (JS challenges, CAPTCHAs)
 */

import type { BotProtectionLevel } from "@bloon/core";
import type { FetchResult } from "./types.js";

/**
 * Detect bot protection level from an HTTP response.
 *
 * Checks headers and body content for known WAF/bot-detection
 * signatures. Returns the most restrictive level found.
 *
 * @param fetchResult - The HTTP response to analyze
 * @returns The detected bot protection level
 */
export function detectBotProtection(fetchResult: FetchResult): BotProtectionLevel {
  const { headers, body, statusCode } = fetchResult;
  const lowerBody = body.toLowerCase();
  const lowerHeaders = toLowerHeaders(headers);

  // --- Full browser required (most restrictive — check first) ---

  // Cloudflare JS challenge page
  if (lowerBody.includes('<div id="challenge-running">')) {
    return "full_browser";
  }

  // CAPTCHA challenge widgets
  if (
    lowerBody.includes("turnstile") ||
    lowerBody.includes("hcaptcha") ||
    lowerBody.includes("recaptcha")
  ) {
    // Only treat as full_browser if these appear to be active challenges,
    // not just script includes. Check for challenge container markers.
    const hasChallengeWidget =
      lowerBody.includes("cf-turnstile") ||
      lowerBody.includes("h-captcha") ||
      lowerBody.includes("g-recaptcha") ||
      lowerBody.includes("recaptcha-container");

    if (hasChallengeWidget) {
      return "full_browser";
    }
  }

  // --- Stealth required (WAF detected but no active JS challenge) ---

  // Cloudflare (headers)
  if (lowerHeaders["cf-ray"] !== undefined || lowerHeaders["server"] === "cloudflare") {
    return "stealth";
  }

  // PerimeterX (headers or body marker)
  if (lowerHeaders["x-px"] !== undefined || lowerBody.includes("_pxhd")) {
    return "stealth";
  }

  // DataDome (headers)
  if (lowerHeaders["x-datadome"] !== undefined || lowerHeaders["server"] === "datadome") {
    return "stealth";
  }

  // Generic 403 with short "access denied" body — likely WAF block
  if (statusCode === 403 && body.length < 1000) {
    const shortBody = lowerBody;
    if (shortBody.includes("access denied") || shortBody.includes("please verify")) {
      return "stealth";
    }
  }

  // --- No protection detected ---
  return "none";
}

// ---- Internal helpers ----

/**
 * Normalize header keys to lowercase for case-insensitive comparison.
 * Returns a new object — does not mutate the input.
 */
function toLowerHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value.toLowerCase();
  }
  return result;
}
