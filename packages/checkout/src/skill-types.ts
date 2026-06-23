/**
 * Types for the per-site checkout "skill" cache.
 *
 * After a checkout SUCCEEDS on a website we persist a committed
 * `site-skills/{domain}/SKILL.md` (+ `skill.json`) documenting exactly how it
 * was done: the literal CSS selectors that matched, the page-type flow, and a
 * split between VARIABLE inputs (shipping/contact, date/time/qty/variant) and
 * FIXED structural elements (buttons, OTP field, card-field selectors).
 *
 * SECURITY (prime directive): no type in this subsystem carries a field VALUE.
 * Every record holds only a field *label* (a short logical name) and a
 * *selector* string. Card PAN/CVV/expiry, login password, and session token are
 * therefore structurally incapable of entering the skill cache, the renderer,
 * or the LLM narration prompt.
 */
import type { PageType } from "@tomo/core";

/**
 * Where a recorded selector's *value* comes from — this alone decides the
 * VARIABLE-vs-FIXED column in the rendered SKILL.md (no render-time heuristics).
 *
 * - `CDP_SECRET`   card field selectors (number/expiry/cvv/holder). FIXED.
 *                  Only the label + selector are ever recorded — never a value.
 * - `USER_INPUT`   shipping/contact/billing fields. VARIABLE (differ per buyer).
 * - `SELECTION`    radio/checkbox/option choices (date, time, qty, variant). VARIABLE.
 * - `STRUCTURAL`   buttons (add-to-cart / checkout / place-order), OTP field. FIXED.
 */
export type FieldProvenance = "CDP_SECRET" | "USER_INPUT" | "SELECTION" | "STRUCTURAL";

/** The kind of scripted action that produced a recorded selector. */
export type SkillActionKind =
  | "click-button"
  | "fill-shipping"
  | "fill-card"
  | "fill-billing"
  | "select-option"
  | "fill-otp";

/** Whether a step was handled by a scripted selector or fell back to the LLM. */
export type SkillMode = "scripted" | "llm";

/**
 * One selector that matched during a successful run.
 * `fieldLabel` is a logical name (e.g. "email", "add to cart", "card_number")
 * and `matchedSelector` is the literal CSS selector (or text descriptor) that
 * hit. Neither field ever holds a value.
 */
export interface RecordedSelector {
  readonly pageType: PageType;
  readonly action: SkillActionKind;
  readonly fieldLabel: string;
  readonly matchedSelector: string;
  readonly provenance: FieldProvenance;
  readonly mode: SkillMode;
}

/** One page visited during the run, in order. URL is path-only (no query/hash). */
export interface PageFlowEntry {
  readonly index: number;
  readonly pageType: PageType;
  readonly urlPath: string;
}

/**
 * The persisted, structured source-of-truth for a site (`skill.json`).
 * `SKILL.md` is rendered from this; merge/read-back operate on this.
 */
export interface SiteSkillRecord {
  readonly domain: string;
  /** Bumped on every successful merge; useful for diffing. */
  readonly version: number;
  /** Number of successful checkouts that contributed to this skill. */
  readonly successCount: number;
  readonly createdAt: string;
  readonly lastVerifiedAt: string;
  readonly pageFlow: readonly PageFlowEntry[];
  /** Deduped union of every selector seen across contributing runs. */
  readonly selectors: readonly RecordedSelector[];
  /** LLM-written "Learnings & gotchas" prose; absent if narration was skipped/failed. */
  readonly learnings?: string;
  /** Schema version for forward-compat. */
  readonly schema: typeof SITE_SKILL_SCHEMA;
}

/** Current on-disk schema version. */
export const SITE_SKILL_SCHEMA = 1 as const;

/** Repo-relative directory that holds committed per-site skill folders. */
export const SKILL_DIR_NAME = "site-skills";
