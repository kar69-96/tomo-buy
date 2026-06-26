import { isBrowseAvailable, runSkill } from "../client.js";
import type { EbaySearchProduct, EbaySearchResponse } from "../types.js";

const SKILL_ID = "ebay.com/search-products-i9m1v2";

interface RawProduct {
  item_id?: unknown;
  itemId?: unknown;
  title?: unknown;
  price?: unknown;
  currency?: unknown;
  url?: unknown;
  condition?: unknown;
  seller_rating?: unknown;
}

interface RawResult {
  products?: RawProduct[];
  items?: RawProduct[];
}

function normalize(raw: RawProduct): EbaySearchProduct | null {
  const item_id =
    typeof raw.item_id === "string"
      ? raw.item_id
      : typeof raw.itemId === "string"
        ? raw.itemId
        : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const price =
    typeof raw.price === "number"
      ? String(raw.price)
      : typeof raw.price === "string"
        ? raw.price.replace(/[^0-9.]/g, "")
        : "";
  if (!item_id || !title || !price) return null;
  return {
    item_id,
    title,
    price,
    currency: typeof raw.currency === "string" ? raw.currency : "USD",
    url:
      typeof raw.url === "string" && raw.url.trim()
        ? raw.url.trim()
        : `https://www.ebay.com/itm/${item_id}`,
    ...(typeof raw.condition === "string" ? { condition: raw.condition } : {}),
    ...(typeof raw.seller_rating === "number"
      ? { seller_rating: raw.seller_rating }
      : {}),
  };
}

/** Search eBay listings. Returns empty products (no throw) when browse is unavailable. */
export async function searchEbay(query: string): Promise<EbaySearchResponse> {
  if (!isBrowseAvailable()) {
    return { query, products: [], source: "browse_sh" };
  }
  try {
    const raw = await runSkill<RawResult>(SKILL_ID, { query });
    const items = raw.products ?? raw.items ?? [];
    const products = items
      .map(normalize)
      .filter((p): p is EbaySearchProduct => p !== null);
    return { query, products, source: "browse_sh" };
  } catch {
    return { query, products: [], source: "browse_sh" };
  }
}
