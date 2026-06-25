import {
  type Order,
  type ShippingInfo,
  TomoError,
  ErrorCodes,
  generateId,
  createOrder,
  calculateFee,
  calculateTotal,
  getDefaultShipping,
  loadConfig,
} from "@tomo/core";
import { discoverPrice } from "@tomo/checkout";

export interface BuyInput {
  url: string;
  shipping?: ShippingInfo;
  selections?: Record<string, string>;
  /**
   * Some checkouts have no product-page price to discover at quote time — the real
   * total is only known after a multi-step selection happens live in the browser
   * (any non-product checkout: a reservation, registration, service, etc.). When
   * set, a failed/empty price discovery degrades to a price-unknown order instead
   * of throwing, so a no-spend oversight run can still drive to the payment page
   * and read the observed total there. Product purchases leave this false and stay
   * strict.
   */
  allowUnpriced?: boolean;
}

/**
 * Normalize a raw selections object into a clean, trimmed copy.
 *
 * A blank selection (empty/whitespace-only value) is not malformed — it just
 * means "no choice for that option" — so it is silently dropped. Genuinely
 * malformed input (a non-string key or value) throws INVALID_SELECTION.
 *
 * Returns a NEW object; never mutates the input.
 */
export function normalizeSelections(
  selections: Record<string, string> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!selections) return normalized;

  for (const [key, value] of Object.entries(selections)) {
    if (typeof key !== "string" || typeof value !== "string") {
      throw new TomoError(
        ErrorCodes.INVALID_SELECTION,
        "Selections must have string keys and values",
      );
    }
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    // Blank key or value => "no choice for that option": skip, don't fail.
    if (!trimmedKey || !trimmedValue) continue;
    normalized[trimmedKey] = trimmedValue;
  }

  return normalized;
}

export async function buy(input: BuyInput): Promise<Order> {
  const { url } = input;

  // 1. Validate URL
  try {
    new URL(url);
  } catch {
    throw new TomoError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
  }

  // 2. Resolve shipping
  const resolvedShipping = input.shipping || getDefaultShipping();
  if (!resolvedShipping) {
    throw new TomoError(
      ErrorCodes.SHIPPING_REQUIRED,
      "Shipping address required for browser checkout (no defaults configured)",
    );
  }

  // Validate all required shipping fields are non-empty
  const shipping = resolvedShipping;
  const requiredShippingFields = ['name', 'street', 'city', 'state', 'zip', 'country', 'email', 'phone'] as const;
  const blankFields = requiredShippingFields.filter(f => !shipping[f]?.trim());
  if (blankFields.length > 0) {
    throw new TomoError(
      ErrorCodes.MISSING_FIELD,
      `Missing required fields: ${blankFields.map(f => `shipping.${f}`).join(', ')}`,
    );
  }

  // Normalize selections: drop blank (no-choice) options, keep trimmed pairs,
  // and throw only on genuinely malformed (non-string) input.
  const selections = normalizeSelections(input.selections);

  // 3. Discover price. When allowUnpriced is set, a failed discovery is expected
  //    (no product-page price to quote) — degrade to a price-unknown order so the
  //    browser can still drive to payment and read the real total live.
  let productName: string;
  let price: string;
  let priceSource: string;
  let imageUrl: string | undefined;
  try {
    const discovery = await discoverPrice(url, resolvedShipping);
    productName = discovery.name;
    price = discovery.price;
    priceSource = discovery.method;
    imageUrl = discovery.image_url;
  } catch (e) {
    if (e instanceof TomoError && !input.allowUnpriced) throw e;
    if (!input.allowUnpriced) {
      throw new TomoError(
        ErrorCodes.PRICE_EXTRACTION_FAILED,
        `Price discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
    // No price at quote time — the real total is read at the payment page.
    productName = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
    })();
    price = "0.00";
    priceSource = "unpriced_booking";
    imageUrl = undefined;
  }

  // 4. Calculate fees
  const fee = calculateFee(price);
  const total = calculateTotal(price);

  // 5. Build order
  const config = loadConfig();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.default_order_expiry_seconds * 1000,
  );

  const order: Order = {
    order_id: generateId("ord"),
    status: "awaiting_confirmation",
    product: {
      name: productName,
      url,
      price,
      source: priceSource,
      image_url: imageUrl,
    },
    payment: {
      total,
      price,
      fee,
      fee_rate: "2%",
    },
    shipping: resolvedShipping,
    selections,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await createOrder(order);

  return order;
}
