import { isBrowseAvailable, runSkill } from "../client.js";
import type { AmazonSearchProduct, AmazonSearchResponse } from "../types.js";

const SKILL_ID = "amazon.com/search-products-5170mf";

interface RawProduct {
  asin?: unknown;
  title?: unknown;
  price?: unknown;
  currency?: unknown;
  url?: unknown;
  rating?: unknown;
  review_count?: unknown;
}

interface RawResult {
  products?: RawProduct[];
  results?: RawProduct[];
}

function normalize(raw: RawProduct): AmazonSearchProduct | null {
  const asin = typeof raw.asin === "string" ? raw.asin.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const price =
    typeof raw.price === "number"
      ? String(raw.price)
      : typeof raw.price === "string"
        ? raw.price.replace(/[^0-9.]/g, "")
        : "";
  if (!asin || !title || !price) return null;
  return {
    asin,
    title,
    price,
    currency: typeof raw.currency === "string" ? raw.currency : "USD",
    url:
      typeof raw.url === "string" && raw.url.trim()
        ? raw.url.trim()
        : `https://www.amazon.com/dp/${asin}`,
    ...(typeof raw.rating === "number" ? { rating: raw.rating } : {}),
    ...(typeof raw.review_count === "number"
      ? { review_count: raw.review_count }
      : {}),
  };
}

/** Search Amazon. Returns empty products (no throw) when browse is unavailable. */
export async function searchAmazon(query: string): Promise<AmazonSearchResponse> {
  if (!isBrowseAvailable()) {
    return { query, products: [], source: "browse_sh" };
  }
  try {
    const raw = await runSkill<RawResult>(SKILL_ID, { query });
    const items = raw.products ?? raw.results ?? [];
    const products = items
      .map(normalize)
      .filter((p): p is AmazonSearchProduct => p !== null);
    return { query, products, source: "browse_sh" };
  } catch {
    return { query, products: [], source: "browse_sh" };
  }
}
