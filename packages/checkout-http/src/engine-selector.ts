/**
 * Engine selector — routes checkout requests to either the HTTP
 * engine (fast, cached) or the Stagehand browser engine (reliable,
 * LLM-assisted).
 *
 * Decision is based solely on the site profile cache state:
 *   - No profile         -> Stagehand (first-run analysis)
 *   - Stale profile      -> Stagehand (re-learn needed)
 *   - Not HTTP eligible  -> Stagehand (bot-protected domain)
 *   - Fresh + eligible   -> HTTP engine (cached replay)
 */

import { loadProfile, isProfileStale } from "./profile-cache.js";

export type EngineChoice = "http" | "stagehand";

/**
 * Select which checkout engine should handle a domain.
 *
 * @param domain - The target domain (e.g., "example.com")
 * @returns The engine to use for this checkout
 */
export function selectEngine(domain: string): EngineChoice {
  const profile = loadProfile(domain);

  // No cached profile — need first-run analysis via Stagehand
  if (!profile) {
    return "stagehand";
  }

  // Profile exists but is stale — needs re-learn via Stagehand
  if (isProfileStale(profile)) {
    return "stagehand";
  }

  // Profile exists but domain is not HTTP-eligible (bot protection, etc.)
  if (!profile.httpEligible) {
    return "stagehand";
  }

  // Fresh, HTTP-eligible profile — use cached HTTP engine
  return "http";
}
