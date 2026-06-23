/**
 * Direct Stripe API integration for HTTP checkout.
 *
 * Card data goes straight to Stripe's tokenization endpoint via HTTPS.
 * This NEVER passes through any LLM — it's a direct API call with
 * the publishable key as bearer auth.
 *
 * Two operations:
 *   1. createPaymentMethod — tokenize card → pm_xxx
 *   2. confirmPaymentIntent — confirm a pi_ with a pm_
 */

import type { CardInfo } from "@bloon/core";

// ---- Constants ----

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 15_000;

// ---- Response types ----

export type CreatePaymentMethodResult =
  | { readonly paymentMethodId: string }
  | { readonly error: string };

export type ConfirmPaymentIntentResult = {
  readonly success: boolean;
  readonly error?: string;
};

// ---- Helpers ----

/**
 * Parse expiry month from CardInfo.expiry (format: "MM/YY" or "MM/YYYY").
 */
function parseExpMonth(expiry: string): string {
  const parts = expiry.split("/");
  return parts[0]?.trim() ?? "";
}

/**
 * Parse expiry year from CardInfo.expiry (format: "MM/YY" or "MM/YYYY").
 * Always returns 4-digit year.
 */
function parseExpYear(expiry: string): string {
  const parts = expiry.split("/");
  const year = parts[1]?.trim() ?? "";
  if (year.length === 2) {
    return `20${year}`;
  }
  return year;
}

/**
 * Extract the payment intent ID from a client secret.
 * Format: "pi_xxx_secret_yyy" -> "pi_xxx"
 */
function extractIntentId(clientSecret: string): string | null {
  const secretIndex = clientSecret.indexOf("_secret_");
  if (secretIndex === -1) return null;
  return clientSecret.slice(0, secretIndex);
}

/**
 * Safely extract an error message from a Stripe API error response.
 */
function parseStripeError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string; type?: string };
    };
    const err = parsed.error;
    if (err?.message) return err.message;
    if (err?.code) return err.code;
    return "Unknown Stripe error";
  } catch {
    return "Failed to parse Stripe error response";
  }
}

// ---- Public API ----

/**
 * Create a Stripe PaymentMethod by tokenizing card details.
 *
 * POSTs to /v1/payment_methods with form-encoded card data.
 * Auth uses the store's publishable key (pk_live_* or pk_test_*).
 *
 * SECURITY: Card data is sent directly to Stripe over HTTPS.
 * It never touches any LLM, log, or intermediate storage.
 *
 * @param publishableKey - Stripe publishable key (pk_live_* or pk_test_*)
 * @param card - Card information from secure env config
 * @returns Payment method ID (pm_xxx) or error message
 */
export async function createPaymentMethod(
  publishableKey: string,
  card: CardInfo,
): Promise<CreatePaymentMethodResult> {
  const params = new URLSearchParams();
  params.append("type", "card");
  params.append("card[number]", card.number);
  params.append("card[exp_month]", parseExpMonth(card.expiry));
  params.append("card[exp_year]", parseExpYear(card.expiry));
  params.append("card[cvc]", card.cvv);

  try {
    const response = await fetch(`${STRIPE_API_BASE}/payment_methods`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });

    const body = await response.text();

    if (!response.ok) {
      return { error: parseStripeError(body) };
    }

    const parsed = JSON.parse(body) as { id?: string };
    if (!parsed.id) {
      return { error: "Stripe response missing payment method ID" };
    }

    return { paymentMethodId: parsed.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Stripe createPaymentMethod failed: ${message}` };
  }
}

/**
 * Confirm a Stripe PaymentIntent with a PaymentMethod.
 *
 * Extracts the intent ID from the client secret, then POSTs
 * to /v1/payment_intents/{id}/confirm.
 *
 * @param publishableKey - Stripe publishable key
 * @param clientSecret - Full client secret (pi_xxx_secret_yyy)
 * @param paymentMethodId - Payment method ID (pm_xxx)
 * @returns Success indicator and optional error
 */
export async function confirmPaymentIntent(
  publishableKey: string,
  clientSecret: string,
  paymentMethodId: string,
): Promise<ConfirmPaymentIntentResult> {
  const intentId = extractIntentId(clientSecret);
  if (!intentId) {
    return {
      success: false,
      error: "Invalid client secret format — cannot extract intent ID",
    };
  }

  const params = new URLSearchParams();
  params.append("payment_method", paymentMethodId);
  params.append("client_secret", clientSecret);

  try {
    const response = await fetch(
      `${STRIPE_API_BASE}/payment_intents/${intentId}/confirm`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${publishableKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      },
    );

    const body = await response.text();

    if (!response.ok) {
      return { success: false, error: parseStripeError(body) };
    }

    const parsed = JSON.parse(body) as { status?: string };
    const succeeded =
      parsed.status === "succeeded" || parsed.status === "requires_capture";

    return {
      success: succeeded,
      error: succeeded ? undefined : `Unexpected intent status: ${parsed.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      error: `Stripe confirmPaymentIntent failed: ${message}`,
    };
  }
}
