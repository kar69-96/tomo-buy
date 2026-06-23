/**
 * Response fingerprint generation and comparison for staleness
 * detection (Layer 2).
 *
 * A fingerprint captures the structural signature of an HTTP response:
 * form field names and actions for HTML, top-level keys for JSON,
 * plus status code and content type. When a cached fingerprint
 * diverges from the live response (Jaccard similarity below threshold),
 * the profile is marked stale and must be re-learned.
 *
 * Pure functions -- no side effects, no network calls.
 */

import * as cheerio from "cheerio";
import type { ResponseFingerprint } from "@bloon/core";
import { FINGERPRINT_SIMILARITY_THRESHOLD } from "@bloon/core";
import type { FetchResult } from "./types.js";

// ---- Fingerprint generation ----

/**
 * Generate a ResponseFingerprint from a FetchResult.
 *
 * For HTML responses: extracts form field names and form action paths.
 * For JSON responses: extracts top-level object keys.
 * Always includes status code and content type.
 *
 * @param fetchResult - The HTTP response to fingerprint
 * @returns Immutable ResponseFingerprint
 */
export function generateFingerprint(fetchResult: FetchResult): ResponseFingerprint {
  const contentType = fetchResult.contentType.toLowerCase();
  const isHtml = contentType.includes("text/html");
  const isJson = contentType.includes("application/json");

  const base: {
    statusCode: number;
    contentType: string;
    formFieldNames?: readonly string[];
    formActions?: readonly string[];
    jsonKeys?: readonly string[];
  } = {
    statusCode: fetchResult.statusCode,
    contentType: fetchResult.contentType,
  };

  if (isHtml) {
    const $ = cheerio.load(fetchResult.body);

    // Collect all form field names
    const fieldNames = new Set<string>();
    $("input, select, textarea").each((_, el) => {
      const name = $(el).attr("name");
      if (name) {
        fieldNames.add(name);
      }
    });

    // Collect all form action paths
    const formActions = new Set<string>();
    $("form[action]").each((_, el) => {
      const action = $(el).attr("action");
      if (action) {
        // Normalize to path only (strip origin for comparison stability)
        try {
          const url = new URL(action, fetchResult.finalUrl);
          formActions.add(url.pathname);
        } catch {
          formActions.add(action);
        }
      }
    });

    return {
      ...base,
      formFieldNames: [...fieldNames].sort(),
      formActions: [...formActions].sort(),
    };
  }

  if (isJson) {
    try {
      const parsed: unknown = JSON.parse(fetchResult.body);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed as Record<string, unknown>).sort();
        return {
          ...base,
          jsonKeys: keys,
        };
      }
    } catch {
      // Invalid JSON -- return base fingerprint only
    }
  }

  return base;
}

// ---- Jaccard similarity ----

/**
 * Compute Jaccard similarity between two sets.
 * Returns |intersection| / |union|, or 1.0 if both sets are empty.
 */
function jaccardSimilarity(
  setA: ReadonlySet<string>,
  setB: ReadonlySet<string>,
): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  if (unionSize === 0) return 1.0;

  return intersectionSize / unionSize;
}

/**
 * Compare two ResponseFingerprints using Jaccard similarity.
 *
 * Combines form field names, form actions, and JSON keys into a
 * unified set for comparison. Status code and content type mismatches
 * apply a penalty.
 *
 * @param cached - The fingerprint stored in the SiteProfile
 * @param actual - The fingerprint generated from a live response
 * @returns Similarity score from 0.0 (completely different) to 1.0 (identical)
 */
export function compareFingerprints(
  cached: ResponseFingerprint,
  actual: ResponseFingerprint,
): number {
  // Build combined string sets from all available fields
  const cachedSet = new Set<string>();
  const actualSet = new Set<string>();

  // Add form field names (prefixed to avoid collisions with json keys)
  for (const name of cached.formFieldNames ?? []) {
    cachedSet.add(`field:${name}`);
  }
  for (const name of actual.formFieldNames ?? []) {
    actualSet.add(`field:${name}`);
  }

  // Add form actions
  for (const action of cached.formActions ?? []) {
    cachedSet.add(`action:${action}`);
  }
  for (const action of actual.formActions ?? []) {
    actualSet.add(`action:${action}`);
  }

  // Add JSON keys
  for (const key of cached.jsonKeys ?? []) {
    cachedSet.add(`key:${key}`);
  }
  for (const key of actual.jsonKeys ?? []) {
    actualSet.add(`key:${key}`);
  }

  let similarity = jaccardSimilarity(cachedSet, actualSet);

  // Apply penalties for status code or content type mismatch
  if (
    cached.statusCode !== undefined &&
    actual.statusCode !== undefined &&
    cached.statusCode !== actual.statusCode
  ) {
    similarity *= 0.8;
  }

  if (
    cached.contentType !== undefined &&
    actual.contentType !== undefined &&
    cached.contentType !== actual.contentType
  ) {
    similarity *= 0.9;
  }

  return similarity;
}

// ---- Staleness check ----

/**
 * Determine whether a cached fingerprint is stale compared to a live one.
 *
 * @param cached - The fingerprint stored in the SiteProfile
 * @param actual - The fingerprint generated from a live response
 * @returns true if Jaccard similarity is below FINGERPRINT_SIMILARITY_THRESHOLD
 */
export function isFingerprintStale(
  cached: ResponseFingerprint,
  actual: ResponseFingerprint,
): boolean {
  return compareFingerprints(cached, actual) < FINGERPRINT_SIMILARITY_THRESHOLD;
}
