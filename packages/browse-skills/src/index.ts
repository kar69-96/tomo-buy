export type {
  AmazonSearchProduct,
  AmazonSearchResponse,
  AmazonStorefrontPrice,
  AmazonGlobalPricesResponse,
  EbaySearchProduct,
  EbaySearchResponse,
  BrowseSearchResult,
  BrowseSearchResponse,
  BrowseComparePricesResponse,
} from "./types.js";

export { isBrowseAvailable } from "./client.js";
export { searchAmazon } from "./skills/amazon-search.js";
export { compareAmazonPrices } from "./skills/amazon-global-prices.js";
export { searchEbay } from "./skills/ebay-search.js";

import { searchAmazon } from "./skills/amazon-search.js";
import { searchEbay } from "./skills/ebay-search.js";
import { compareAmazonPrices } from "./skills/amazon-global-prices.js";
import type {
  BrowseSearchResponse,
  BrowseSearchResult,
  BrowseComparePricesResponse,
  AmazonSearchProduct,
  EbaySearchProduct,
} from "./types.js";

/**
 * Search Amazon + eBay simultaneously. Merges results sorted by price ascending.
 * Never throws: returns empty results when browse is unavailable.
 */
export async function searchProducts(
  query: string,
): Promise<BrowseSearchResponse> {
  const [amazonResp, ebayResp] = await Promise.all([
    searchAmazon(query),
    searchEbay(query),
  ]);

  const amazonResults: BrowseSearchResult[] = amazonResp.products.map(
    (p: AmazonSearchProduct) => ({
      title: p.title,
      price: p.price,
      currency: p.currency,
      url: p.url,
      source: "amazon" as const,
      asin: p.asin,
      ...(p.rating !== undefined ? { rating: p.rating } : {}),
    }),
  );

  const ebayResults: BrowseSearchResult[] = ebayResp.products.map(
    (p: EbaySearchProduct) => ({
      title: p.title,
      price: p.price,
      currency: p.currency,
      url: p.url,
      source: "ebay" as const,
      item_id: p.item_id,
    }),
  );

  const results = [...amazonResults, ...ebayResults].sort((a, b) => {
    const pa = parseFloat(a.price) || Infinity;
    const pb = parseFloat(b.price) || Infinity;
    return pa - pb;
  });

  return {
    query,
    results,
    source_breakdown: {
      amazon: amazonResults.length,
      ebay: ebayResults.length,
    },
  };
}

/**
 * Find the cheapest Amazon storefront for a query: search → take top ASIN → compare global prices.
 * Never throws; returns empty comparisons when browse is unavailable or no ASIN found.
 */
export async function comparePrices(
  query: string,
): Promise<BrowseComparePricesResponse> {
  const amazonResp = await searchAmazon(query);
  const topAsin = amazonResp.products[0]?.asin;
  if (!topAsin) {
    return { query, comparisons: [] };
  }
  const globalPrices = await compareAmazonPrices(topAsin);
  return {
    query,
    asin: topAsin,
    comparisons: [...globalPrices.prices],
  };
}
