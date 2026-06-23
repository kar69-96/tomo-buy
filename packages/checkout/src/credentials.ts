import { getCardInfo, getBillingInfo } from "@bloon/core";
import type { ShippingInfo, CredentialsMap } from "@bloon/core";

// ---- CDP-only fields (card data — never sent through Stagehand LLM) ----

const CDP_FIELDS: ReadonlySet<string> = new Set([
  "x_card_number",
  "x_card_expiry",
  "x_card_cvv",
  "x_cardholder_name",
]);

export function isCdpField(fieldName: string): boolean {
  return CDP_FIELDS.has(fieldName);
}

// ---- Phone formatting ----

export function formatPhone(phone: string, country: string): string {
  const digits = phone.replace(/\D/g, "");
  const upper = country.toUpperCase();

  // US/CA: format as (xxx) xxx-xxxx
  if ((upper === "US" || upper === "CA") && digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if ((upper === "US" || upper === "CA") && digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  // Others: return raw digits with country prefix if not already present
  return digits;
}

// ---- Sanitization (prevent prompt injection via Stagehand variables) ----

const UNSAFE_CHARS = /[<>"'&;]/g;
const MAX_FIELD_LENGTH = 200;

export function sanitizeShipping(shipping: ShippingInfo): ShippingInfo {
  function clean(value: string): string {
    return value.replace(UNSAFE_CHARS, "").slice(0, MAX_FIELD_LENGTH);
  }

  return {
    name: clean(shipping.name),
    street: clean(shipping.street),
    apartment: shipping.apartment ? clean(shipping.apartment) : undefined,
    city: clean(shipping.city),
    state: clean(shipping.state),
    zip: clean(shipping.zip),
    country: clean(shipping.country),
    email: clean(shipping.email),
    phone: clean(shipping.phone),
  };
}

// ---- Build full credentials map from .env + shipping ----

export function buildCredentials(shipping: ShippingInfo): CredentialsMap {
  const card = getCardInfo();
  const billing = getBillingInfo();
  const safe = sanitizeShipping(shipping);

  return {
    x_card_number: card.number,
    x_card_expiry: card.expiry,
    x_card_cvv: card.cvv,
    x_cardholder_name: card.cardholder_name,
    x_billing_street: billing.street,
    x_billing_city: billing.city,
    x_billing_state: billing.state,
    x_billing_zip: billing.zip,
    x_billing_country: billing.country,
    x_shipping_name: safe.name,
    x_shipping_street: safe.street,
    x_shipping_apartment: safe.apartment ?? "",
    x_shipping_city: safe.city,
    x_shipping_state: safe.state,
    x_shipping_zip: safe.zip,
    x_shipping_country: safe.country,
    x_shipping_email: safe.email,
    x_shipping_phone: formatPhone(safe.phone, safe.country),
  };
}

// ---- Split credentials by channel ----

export function getStagehandVariables(
  creds: CredentialsMap,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(creds)) {
    if (!isCdpField(key)) {
      result[key] = value;
    }
  }
  return result;
}

export function getCdpCredentials(
  creds: CredentialsMap,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(creds)) {
    if (isCdpField(key)) {
      result[key] = value;
    }
  }
  return result;
}
