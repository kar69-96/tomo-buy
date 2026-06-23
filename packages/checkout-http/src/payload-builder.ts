/**
 * Resolves PayloadField[] from an EndpointStep into a concrete request body.
 *
 * Each field has a source type (USER_INPUT, PREVIOUS_RESPONSE, PAGE_TOKEN, STATIC)
 * and a sourceKey that determines where the value comes from:
 *   - USER_INPUT: shipping/billing/card data keyed by dot notation
 *   - PREVIOUS_RESPONSE: extracted values from prior step responses
 *   - PAGE_TOKEN: CSRF or session tokens
 *   - STATIC: literal hardcoded values
 *
 * Returns { body, missingFields } where body is formatted per contentType
 * and missingFields lists any unresolvable PREVIOUS_RESPONSE keys.
 */

import type { PayloadField } from "@bloon/core";
import type { ShippingInfo, BillingInfo } from "@bloon/core";
import { getBillingInfo } from "@bloon/core";
import type { ExecutionContext } from "./types.js";

// ---- User input lookup map ----

type UserInputLookup = Readonly<Record<string, string>>;

/**
 * Build a flat lookup map from shipping, billing, and card data.
 * Keys use dot notation matching PayloadField.sourceKey values.
 */
/**
 * Card field keys are EXCLUDED from the generic lookup map.
 * Card data must only flow through stripe-client.ts (direct Stripe API),
 * never through buildPayload for general merchant endpoints.
 */
const BLOCKED_CARD_KEYS = new Set([
  "card.number",
  "card.expiry",
  "card.cvv",
  "card.cardholder_name",
  "card.exp_month",
  "card.exp_year",
]);

function buildUserInputLookup(
  shipping: ShippingInfo,
  billing: BillingInfo,
): UserInputLookup {
  return {
    // Shipping fields
    "shipping.name": shipping.name,
    "shipping.email": shipping.email,
    "shipping.phone": shipping.phone,
    "shipping.street": shipping.street,
    "shipping.apartment": shipping.apartment ?? "",
    "shipping.city": shipping.city,
    "shipping.state": shipping.state,
    "shipping.zip": shipping.zip,
    "shipping.country": shipping.country,

    // Billing fields
    "billing.street": billing.street,
    "billing.city": billing.city,
    "billing.state": billing.state,
    "billing.zip": billing.zip,
    "billing.country": billing.country,
  };
}

// ---- Resolve a single field ----

interface ResolvedField {
  readonly fieldName: string;
  readonly value: string | null;
  readonly missingKey?: string;
}

function resolveField(
  field: PayloadField,
  lookup: UserInputLookup,
  context: ExecutionContext,
): ResolvedField {
  switch (field.source) {
    case "USER_INPUT": {
      // Block card data from flowing through generic payloads.
      // Card data must only go through stripe-client.ts.
      if (BLOCKED_CARD_KEYS.has(field.sourceKey)) {
        return { fieldName: field.fieldName, value: null, missingKey: field.sourceKey };
      }
      const value = lookup[field.sourceKey];
      if (value === undefined) {
        return { fieldName: field.fieldName, value: null, missingKey: field.sourceKey };
      }
      return { fieldName: field.fieldName, value };
    }

    case "PREVIOUS_RESPONSE": {
      const value = context.extractedValues[field.sourceKey];
      if (value === undefined) {
        return { fieldName: field.fieldName, value: null, missingKey: field.sourceKey };
      }
      return { fieldName: field.fieldName, value };
    }

    case "PAGE_TOKEN": {
      // Check CSRF token first, then extracted values
      const csrfValue = context.session.csrfToken;
      const extractedValue = context.extractedValues[field.sourceKey];
      const value = csrfValue ?? extractedValue;
      if (value === undefined) {
        return { fieldName: field.fieldName, value: null, missingKey: field.sourceKey };
      }
      return { fieldName: field.fieldName, value };
    }

    case "STATIC": {
      // sourceKey IS the literal value
      return { fieldName: field.fieldName, value: field.sourceKey };
    }

    default: {
      return { fieldName: field.fieldName, value: null, missingKey: field.sourceKey };
    }
  }
}

// ---- Format body ----

function formatAsJson(
  resolved: readonly ResolvedField[],
): string {
  const obj: Record<string, string> = {};
  for (const r of resolved) {
    if (r.value !== null) {
      obj[r.fieldName] = r.value;
    }
  }
  return JSON.stringify(obj);
}

function formatAsFormEncoded(
  resolved: readonly ResolvedField[],
): string {
  const params = new URLSearchParams();
  for (const r of resolved) {
    if (r.value !== null) {
      params.append(r.fieldName, r.value);
    }
  }
  return params.toString();
}

// ---- Public API ----

export interface PayloadResult {
  readonly body: string;
  readonly missingFields: readonly string[];
}

/**
 * Resolve an array of PayloadFields into a request body string.
 *
 * @param fields - The payload template from the EndpointStep
 * @param context - Current execution context with extracted values and session
 * @param shipping - User's shipping information
 * @param contentType - Determines body encoding (JSON or form-encoded)
 * @returns body string and list of any unresolvable field keys
 */
export function buildPayload(
  fields: readonly PayloadField[],
  context: ExecutionContext,
  shipping: ShippingInfo,
  contentType: "application/json" | "application/x-www-form-urlencoded",
): PayloadResult {
  const billing = getBillingInfo();
  const lookup = buildUserInputLookup(shipping, billing);

  const resolved: ResolvedField[] = [];
  const missingFields: string[] = [];

  for (const field of fields) {
    const result = resolveField(field, lookup, context);
    resolved.push(result);

    if (result.value === null && result.missingKey) {
      missingFields.push(result.missingKey);
    }
  }

  const body =
    contentType === "application/json"
      ? formatAsJson(resolved)
      : formatAsFormEncoded(resolved);

  return { body, missingFields };
}
