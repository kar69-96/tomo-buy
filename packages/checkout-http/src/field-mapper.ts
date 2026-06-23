/**
 * Map site-specific field names to Bloon's standard field names.
 *
 * Rule-based first, then LLM fallback (Gemini) for unknown fields.
 */

import type { FieldMapping } from "@bloon/core";
import type { FormField } from "./types.js";

// ---- Autocomplete attribute → standard field name ----

const AUTOCOMPLETE_MAP: Readonly<Record<string, string>> = {
  email: "shipping.email",
  "given-name": "shipping.firstName",
  "family-name": "shipping.lastName",
  name: "shipping.name",
  "address-line1": "shipping.street",
  "address-line2": "shipping.apartment",
  "address-level2": "shipping.city",
  "address-level1": "shipping.state",
  "postal-code": "shipping.zip",
  country: "shipping.country",
  "country-name": "shipping.country",
  tel: "shipping.phone",
  "cc-number": "card.number",
  "cc-exp": "card.expiry",
  "cc-csc": "card.cvv",
  "cc-name": "card.name",
};

// ---- Name pattern rules (tested against lowercase) ----
// Each entry: [regex, standardField]

const NAME_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/email/i, "shipping.email"],
  [/first[_-]?name|given[_-]?name/i, "shipping.firstName"],
  [/last[_-]?name|family[_-]?name/i, "shipping.lastName"],
  [/address[_-]?line1|address1|street|line1/i, "shipping.street"],
  [/address[_-]?line2|address2|apt|apartment|suite/i, "shipping.apartment"],
  [/city/i, "shipping.city"],
  [/state|province|region|administrative[_-]?area/i, "shipping.state"],
  [/zip|postal|postcode/i, "shipping.zip"],
  [/country/i, "shipping.country"],
  [/phone|tel/i, "shipping.phone"],
  [/cardnumber|card[_-]number|cc[_-]number/i, "card.number"],
  [/exp|expiry|expiration/i, "card.expiry"],
  [/cvc|cvv|security/i, "card.cvv"],
];

// ---- Noise field patterns (skip entirely) ----

const NOISE_PATTERNS: readonly RegExp[] = [
  /csrf/i,
  /\btoken\b/i,
  /^utm_/i,
  /^_token$/i,
  /authenticity_token/i,
  /nonce/i,
];

/**
 * Extract the innermost bracket key from a field name.
 * For `checkout[shipping_address][first_name]` returns `first_name`.
 * For non-bracket names returns the original name.
 */
function extractInnermostKey(name: string): string {
  const matches = name.match(/\[([^\]]+)\]/g);
  if (!matches || matches.length === 0) {
    return name;
  }
  // Last bracket group, strip the brackets
  const last = matches[matches.length - 1];
  return last.slice(1, -1);
}

/**
 * Return true if the field name matches a known noise pattern
 * that should be skipped (CSRF tokens, UTM params, etc.).
 */
function isNoiseField(name: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Try to match a field by its autocomplete attribute.
 * Returns the standard field name, or undefined if no match.
 */
function matchByAutocomplete(field: FormField): string | undefined {
  if (!field.autocomplete) {
    return undefined;
  }
  // Autocomplete values can include section/hint tokens (e.g. "shipping given-name").
  // We check each token against our map.
  const tokens = field.autocomplete.trim().toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const mapped = AUTOCOMPLETE_MAP[token];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return undefined;
}

/**
 * Try to match a field by its name (or innermost bracket key)
 * against known patterns. Returns the standard field name,
 * or undefined if no match.
 */
function matchByNamePattern(
  key: string,
  field: FormField,
): string | undefined {
  for (const [regex, standardField] of NAME_PATTERNS) {
    if (regex.test(key)) {
      // For CVV-like fields, skip if the field is a select (dropdown)
      if (
        standardField === "card.cvv" &&
        field.type === "select"
      ) {
        continue;
      }
      return standardField;
    }
  }
  return undefined;
}

/**
 * Map a list of form fields to standard field names. Rule-based only.
 *
 * Matching priority:
 * 1. autocomplete attribute (highest)
 * 2. field name pattern matching (case-insensitive, supports bracket notation)
 *
 * Skips hidden fields and common noise fields (CSRF, tokens, UTM params).
 */
export function mapFields(
  fields: readonly FormField[],
): readonly FieldMapping[] {
  const mappings: FieldMapping[] = [];

  for (const field of fields) {
    // Skip hidden fields entirely
    if (field.type === "hidden") {
      continue;
    }

    // Skip noise fields
    if (isNoiseField(field.name)) {
      continue;
    }

    // Priority 1: autocomplete attribute
    const autoMatch = matchByAutocomplete(field);
    if (autoMatch !== undefined) {
      mappings.push({ siteField: field.name, standardField: autoMatch });
      continue;
    }

    // Priority 2: name pattern matching (use innermost bracket key)
    const key = extractInnermostKey(field.name);
    const nameMatch = matchByNamePattern(key, field);
    if (nameMatch !== undefined) {
      mappings.push({ siteField: field.name, standardField: nameMatch });
      continue;
    }
  }

  return mappings;
}

/** Placeholder for future Gemini LLM field mapping. Returns empty array. */
async function mapFieldsWithLLM(
  _fields: readonly FormField[],
  _existingMappings: readonly FieldMapping[],
): Promise<readonly FieldMapping[]> {
  return [];
}
