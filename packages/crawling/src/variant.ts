import type { ProductOption } from "@bloon/core";
import { concurrencyPool } from "@bloon/core";
import type { FirecrawlConfig } from "./types.js";
import { MAX_VARIANT_EXTRACT, VARIANT_EXTRACT_CONCURRENCY } from "./constants.js";
import { stripCurrencySymbol, computeWordOverlap } from "./helpers.js";
import { firecrawlExtractAsync } from "./extract.js";
import { firecrawlCrawlAsync } from "./crawl.js";

// ---- Step 2: Variant URL resolution via /extract ----

export function normalizeToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function valuesLikelyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizeToken(a) === normalizeToken(b);
}

export interface VariantResolutionOptions {
  maxVariantUrls?: number;
}

export async function resolveVariantPricesViaFirecrawl(
  variantUrls: string[],
  currentUrl: string,
  config: FirecrawlConfig,
  baseOptions: ProductOption[],
  opts: VariantResolutionOptions = {},
): Promise<ProductOption[]> {
  const maxVariantUrls =
    opts.maxVariantUrls && opts.maxVariantUrls > 0
      ? opts.maxVariantUrls
      : MAX_VARIANT_EXTRACT;
  // Dedupe URLs, exclude current, cap at MAX_VARIANT_EXTRACT
  const urls = [...new Set(variantUrls)]
    .filter((u) => u !== currentUrl && u.startsWith("http"))
    .slice(0, maxVariantUrls);

  if (urls.length === 0) return baseOptions;

  // Run /extract on each variant URL via concurrency pool
  const results = await concurrencyPool(
    urls,
    async (variantUrl) => {
      const extracts = await firecrawlExtractAsync(
        [variantUrl],
        config,
        60_000,
      );
      return extracts?.[0] ?? null;
    },
    VARIANT_EXTRACT_CONCURRENCY,
  );

  // Build per-option price maps from results
  const optionPriceMaps = new Map<string, Map<string, string>>();

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const extract = result.value;
    if (!extract.price) continue;

    const extractPrice = stripCurrencySymbol(extract.price);
    const extractOptions = extract.options ?? [];

    // For each option group in the variant extract, identify which value is selected
    for (const baseOpt of baseOptions) {
      const matchingExtractOpt = extractOptions.find(
        (eo) => valuesLikelyMatch(eo.name, baseOpt.name),
      );
      if (!matchingExtractOpt) continue;

      // Find a value in this variant's option group that differs from others
      // or is present as the "selected" value (typically 1 value or first value)
      for (const val of matchingExtractOpt.values) {
        const baseMatch = baseOpt.values.find((v) => valuesLikelyMatch(v, val));
        if (baseMatch) {
          if (!optionPriceMaps.has(baseOpt.name)) {
            optionPriceMaps.set(baseOpt.name, new Map());
          }
          const priceMap = optionPriceMaps.get(baseOpt.name)!;
          if (!priceMap.has(baseMatch)) {
            priceMap.set(baseMatch, extractPrice);
          }
        }
      }
    }
  }

  // Merge into baseOptions, applying same-price filter
  return baseOptions.map((opt) => {
    const resolved = optionPriceMaps.get(opt.name);
    if (!resolved || resolved.size === 0) return opt;

    const merged: Record<string, string> = { ...(opt.prices ?? {}) };
    for (const [value, price] of resolved) {
      merged[value] = price;
    }

    // Same-price filter: if all prices are identical, omit
    const uniquePrices = new Set(Object.values(merged));
    if (uniquePrices.size <= 1) return { ...opt, prices: undefined };

    return { ...opt, prices: merged };
  });
}

// ---- Step 3: Crawl fallback for variant pricing ----

export async function resolveVariantPricesViaCrawl(
  url: string,
  config: FirecrawlConfig,
  baseOptions: ProductOption[],
  baseName: string,
): Promise<ProductOption[]> {
  const crawled = await firecrawlCrawlAsync(url, config, 120_000);
  if (!crawled || crawled.length === 0) return baseOptions;

  // Filter crawled pages: keep only those with similar product name, non-empty price, different URL
  const relevant = crawled.filter((page) => {
    if (!page.name || !page.price) return false;
    // Similar product name (word overlap heuristic)
    return computeWordOverlap(page.name, baseName) >= 0.3;
  });

  if (relevant.length === 0) return baseOptions;

  // Build per-option price maps from relevant pages
  const optionPriceMaps = new Map<string, Map<string, string>>();

  for (const page of relevant) {
    if (!page.price) continue;
    const pagePrice = stripCurrencySymbol(page.price);
    const pageOptions = page.options ?? [];

    for (const baseOpt of baseOptions) {
      const matchOpt = pageOptions.find(
        (po) => valuesLikelyMatch(po.name, baseOpt.name),
      );
      if (!matchOpt) continue;

      for (const val of matchOpt.values) {
        const baseMatch = baseOpt.values.find((v) => valuesLikelyMatch(v, val));
        if (baseMatch) {
          if (!optionPriceMaps.has(baseOpt.name)) {
            optionPriceMaps.set(baseOpt.name, new Map());
          }
          const priceMap = optionPriceMaps.get(baseOpt.name)!;
          if (!priceMap.has(baseMatch)) {
            priceMap.set(baseMatch, pagePrice);
          }
        }
      }
    }
  }

  // Merge with same-price filter
  return baseOptions.map((opt) => {
    const resolved = optionPriceMaps.get(opt.name);
    if (!resolved || resolved.size === 0) return opt;

    const merged: Record<string, string> = { ...(opt.prices ?? {}) };
    for (const [value, price] of resolved) {
      merged[value] = price;
    }

    const uniquePrices = new Set(Object.values(merged));
    if (uniquePrices.size <= 1) return { ...opt, prices: undefined };

    return { ...opt, prices: merged };
  });
}
