/**
 * Read/write SiteProfile JSON files to disk.
 *
 * Profiles are stored at ~/.bloon/profiles/{domain}.json with
 * restricted permissions (0o700 directory, 0o600 files). Writes
 * are atomic (write to .tmp, rename) to prevent corruption on
 * crash or concurrent access.
 *
 * TTL-based staleness detection uses adaptive decay: each
 * invalidation halves the TTL (down to MIN_PROFILE_TTL_MS).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SiteProfile } from "@bloon/core";
import {
  DEFAULT_PROFILE_TTL_MS,
  MIN_PROFILE_TTL_MS,
} from "@bloon/core";

// ---- Directory helpers ----

/**
 * Returns the profiles directory path: ~/.bloon/profiles
 */
export function getProfileDir(): string {
  return path.join(os.homedir(), ".bloon", "profiles");
}

/**
 * Ensure the profiles directory exists with restricted permissions.
 * Always enforces 0o700 even if the directory pre-exists.
 */
function ensureProfileDir(): void {
  const dir = getProfileDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(dir, 0o700);
}

/**
 * Build the file path for a domain's profile.
 */
function profilePath(domain: string): string {
  // Sanitize domain to prevent path traversal
  const sanitized = domain.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getProfileDir(), `${sanitized}.json`);
}

// ---- Read ----

/**
 * Validate that a loaded profile doesn't contain endpoint URLs
 * that could route card data to non-Stripe destinations.
 * All urlPatterns must use HTTPS and no non-Stripe step may
 * reference card-related payload fields.
 */
function validateProfileSecurity(profile: SiteProfile): boolean {
  const CARD_SOURCE_KEYS = new Set([
    "card.number", "card.expiry", "card.cvv",
    "card.cardholder_name", "card.exp_month", "card.exp_year",
  ]);

  for (const step of profile.endpoints) {
    // All URLs must be HTTPS
    if (!step.urlPattern.startsWith("https://") && !step.urlPattern.includes("{")) {
      return false;
    }

    // Non-Stripe steps must not reference card fields
    if (!step.urlPattern.includes("api.stripe.com") && step.payload) {
      for (const field of step.payload) {
        if (field.source === "USER_INPUT" && CARD_SOURCE_KEYS.has(field.sourceKey)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Load a cached SiteProfile for the given domain.
 *
 * Validates shape and security invariants before returning.
 * Rejects profiles with non-HTTPS URLs or card data routed
 * to non-Stripe endpoints.
 *
 * @param domain - The domain to look up (e.g., "example.com")
 * @returns The parsed SiteProfile, or null if not found or invalid
 */
export function loadProfile(domain: string): SiteProfile | null {
  const filePath = profilePath(domain);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    // Shape validation
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("domain" in parsed) ||
      !("endpoints" in parsed) ||
      !("staleness" in parsed)
    ) {
      return null;
    }

    const profile = parsed as SiteProfile;

    // Verify endpoints is an array
    if (!Array.isArray(profile.endpoints)) {
      return null;
    }

    // Verify staleness has required fields
    if (
      typeof profile.staleness !== "object" ||
      profile.staleness === null ||
      !("lastValidatedAt" in profile.staleness) ||
      !("currentTtlMs" in profile.staleness)
    ) {
      return null;
    }

    // Security: reject profiles that could leak card data
    if (!validateProfileSecurity(profile)) {
      return null;
    }

    return profile;
  } catch {
    return null;
  }
}

// ---- Write ----

/**
 * Atomically save a SiteProfile to disk.
 *
 * Writes to a .tmp file first, then renames to prevent partial writes.
 *
 * @param profile - The SiteProfile to persist
 */
export function saveProfile(profile: SiteProfile): void {
  ensureProfileDir();

  const filePath = profilePath(profile.domain);
  const tmpPath = filePath + ".tmp";

  const json = JSON.stringify(profile, null, 2);

  fs.writeFileSync(tmpPath, json, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

// ---- Staleness check ----

/**
 * Check whether a cached profile has exceeded its adaptive TTL.
 *
 * The TTL is stored in profile.staleness.currentTtlMs and decays
 * (halves) after each invalidation, with a floor of MIN_PROFILE_TTL_MS.
 *
 * @param profile - The SiteProfile to check
 * @returns true if the profile is stale and should be re-learned
 */
export function isProfileStale(profile: SiteProfile): boolean {
  const { staleness } = profile;
  const lastValidated = new Date(staleness.lastValidatedAt).getTime();

  if (isNaN(lastValidated)) {
    // Can't parse the timestamp -- treat as stale
    return true;
  }

  const ttl = Math.max(staleness.currentTtlMs, MIN_PROFILE_TTL_MS);
  const now = Date.now();

  return now - lastValidated > ttl;
}

// ---- Invalidation ----

/**
 * Delete a cached profile for the given domain.
 *
 * @param domain - The domain whose profile should be removed
 */
export function invalidateProfile(domain: string): void {
  const filePath = profilePath(domain);

  try {
    fs.unlinkSync(filePath);
  } catch {
    // File doesn't exist or already deleted -- no-op
  }
}
