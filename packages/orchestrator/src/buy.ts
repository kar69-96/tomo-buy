import {
  type Order,
  type ShippingInfo,
  BloonError,
  ErrorCodes,
  generateId,
  createOrder,
  calculateFee,
  calculateTotal,
  getDefaultShipping,
  loadConfig,
} from "@bloon/core";
import { discoverPrice } from "@bloon/checkout";

export interface BuyInput {
  url: string;
  shipping?: ShippingInfo;
  selections?: Record<string, string>;
}

export async function buy(input: BuyInput): Promise<Order> {
  const { url } = input;

  // 1. Validate URL
  try {
    new URL(url);
  } catch {
    throw new BloonError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
  }

  // 2. Resolve shipping
  const resolvedShipping = input.shipping || getDefaultShipping();
  if (!resolvedShipping) {
    throw new BloonError(
      ErrorCodes.SHIPPING_REQUIRED,
      "Shipping address required for browser checkout (no defaults configured)",
    );
  }

  // Validate all required shipping fields are non-empty
  const shipping = resolvedShipping;
  const requiredShippingFields = ['name', 'street', 'city', 'state', 'zip', 'country', 'email', 'phone'] as const;
  const blankFields = requiredShippingFields.filter(f => !shipping[f]?.trim());
  if (blankFields.length > 0) {
    throw new BloonError(
      ErrorCodes.MISSING_FIELD,
      `Missing required fields: ${blankFields.map(f => `shipping.${f}`).join(', ')}`,
    );
  }

  // Validate selections if provided
  if (input.selections) {
    for (const [key, value] of Object.entries(input.selections)) {
      if (typeof key !== 'string' || typeof value !== 'string' || !key.trim() || !value.trim()) {
        throw new BloonError(ErrorCodes.INVALID_SELECTION, 'Selections must have non-empty string keys and values');
      }
    }
  }

  // 3. Discover price
  let discovery;
  try {
    discovery = await discoverPrice(url, resolvedShipping);
  } catch (e) {
    if (e instanceof BloonError) throw e;
    throw new BloonError(
      ErrorCodes.PRICE_EXTRACTION_FAILED,
      `Price discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  const productName = discovery.name;
  const price = discovery.price;
  const priceSource = discovery.method;
  const imageUrl = discovery.image_url;

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
    selections: input.selections,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await createOrder(order);

  return order;
}
