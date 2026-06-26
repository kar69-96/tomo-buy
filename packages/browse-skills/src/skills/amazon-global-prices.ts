import { isBrowseAvailable, runSkill } from "../client.js";
import type { AmazonGlobalPricesResponse, AmazonStorefrontPrice } from "../types.js";

const SKILL_ID = "amazon.com/amazon-global-prices-nf9q4d";

interface RawPrice {
  storefront?: unknown;
  marketplace?: unknown;
  price?: unknown;
  currency?: unknown;
  url?: unknown;
  available?: unknown;
}

interface RawResult {
  prices?: RawPrice[];
  storefronts?: RawPrice[];
}

function normalize(raw: RawPrice): AmazonStorefrontPrice | null {
  const storefront =
    typeof raw.storefront === "string"
      ? raw.storefront
      : typeof raw.marketplace === "string"
        ? raw.marketplace
        : "";
  const price =
    typeof raw.price === "number"
      ? String(raw.price)
      : typeof raw.price === "string"
        ? raw.price.replace(/[^0-9.]/g, "")
        : "";
  if (!storefront || !price) return null;
  return {
    storefront,
    price,
    currency: typeof raw.currency === "string" ? raw.currency : "USD",
    url: typeof raw.url === "string" ? raw.url : "",
    available: raw.available !== false,
  };
}

/** Compare Amazon global storefront prices for an ASIN. */
export async function compareAmazonPrices(
  asin: string,
): Promise<AmazonGlobalPricesResponse> {
  if (!isBrowseAvailable()) {
    return { asin, prices: [], source: "browse_sh" };
  }
  try {
    const raw = await runSkill<RawResult>(SKILL_ID, { asin });
    const items = raw.prices ?? raw.storefronts ?? [];
    const prices = items
      .map(normalize)
      .filter((p): p is AmazonStorefrontPrice => p !== null)
      .filter((p) => p.available);
    return { asin, prices, source: "browse_sh" };
  } catch {
    return { asin, prices: [], source: "browse_sh" };
  }
}
