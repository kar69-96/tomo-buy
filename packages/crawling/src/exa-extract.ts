/**
 * Exa.ai discovery stage (Stage 2.5): livecrawl + LLM structured extraction.
 * Fills the gap between server-side scrape (free/fast) and Browserbase (expensive/slow).
 * Skipped entirely if EXA_API_KEY is not set.
 */

import type Exa from "exa-js";
import type { ProductOption } from "@bloon/core";
import type { FullDiscoveryResult } from "./discover.js";
import { stripCurrencySymbol, isValidPrice, mapOptions, computeWordOverlap, cleanExtractField, isRedirectToOtherPage } from "./helpers.js";
import { valuesLikelyMatch } from "./variant.js";
import { ProductNotFoundError } from "./constants.js";
import { getExaClient } from "./exa-client.js";

// ---- Config ----

const EXA_LIVECRAWL_TIMEOUT_MS = parseInt(
  process.env.EXA_LIVECRAWL_TIMEOUT_MS ?? "15000",
  10,
);
const EXA_MAX_VARIANT_RESULTS = parseInt(
  process.env.EXA_MAX_VARIANT_RESULTS ?? "10",
  10,
);
const EXA_EXTRACT_TIMEOUT_MS = parseInt(
  process.env.EXA_EXTRACT_TIMEOUT_MS ?? "20000",
  10,
);

// ---- Product extraction schema ----

const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name or title" },
    price: { type: "string", description: "Current selling price with currency symbol" },
    original_price: { type: "string", description: "Original price before discount" },
    currency: { type: "string", description: "Currency code, e.g. USD, EUR" },
    brand: { type: "string", description: "Brand or manufacturer" },
    image_url: { type: "string", description: "Main product image URL" },
    product_description: { type: "string", description: "Short product description" },
    options: {
      type: "string",
      description: 'JSON array of option groups, each with name (string) and values (string[]). Example: [{"name":"Color","values":["Red","Blue"]}]',
    },
  },
  required: ["name", "price"],
};

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name or title" },
    price: { type: "string", description: "Current selling price with currency symbol" },
    options: {
      type: "string",
      description: "JSON array of option groups, each with name (string) and values (string[])",
    },
  },
  required: ["name", "price"],
};

// ---- Helpers ----

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

interface ParsedOptions {
  name: string;
  values: string[];
}

function parseOptionsString(optionsStr: string | undefined): ParsedOptions[] {
  if (!optionsStr) return [];
  try {
    const parsed = JSON.parse(optionsStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o: unknown): o is ParsedOptions =>
        typeof o === "object" &&
        o !== null &&
        "name" in o &&
        "values" in o &&
        typeof (o as ParsedOptions).name === "string" &&
        Array.isArray((o as ParsedOptions).values),
    );
  } catch {
    return [];
  }
}


// ---- Variant resolution via Exa search ----

async function resolveVariantPricesViaExa(
  exa: InstanceType<typeof Exa>,
  productName: string,
  baseUrl: string,
  baseOptions: ProductOption[],
): Promise<ProductOption[]> {
  const domain = extractDomain(baseUrl);
  if (!domain || baseOptions.length === 0) return baseOptions;

  const searchResult = await Promise.race([
    exa.searchAndContents(productName, {
      includeDomains: [domain],
      numResults: EXA_MAX_VARIANT_RESULTS,
      summary: {
        query: "Extract product name, price, and options as structured JSON",
        schema: VARIANT_SCHEMA,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Exa variant search timeout")), EXA_EXTRACT_TIMEOUT_MS),
    ),
  ]);

  const results = searchResult.results ?? [];

  // Build per-option price maps
  const optionPriceMaps = new Map<string, Map<string, string>>();

  for (const variantResult of results) {
    if (variantResult.url === baseUrl) continue;
    if (!variantResult.summary) continue;

    let parsed: { name?: string; price?: string; options?: string };
    try {
      parsed = JSON.parse(variantResult.summary);
    } catch {
      continue;
    }

    if (!parsed.name || !parsed.price || !isValidPrice(parsed.price)) continue;

    // Filter by word overlap with base product name
    if (computeWordOverlap(parsed.name, productName) < 0.3) continue;

    const variantPrice = stripCurrencySymbol(parsed.price);
    const variantOptions = parseOptionsString(parsed.options);

    for (const baseOpt of baseOptions) {
      const matchingOpt = variantOptions.find(
        (vo) => valuesLikelyMatch(vo.name, baseOpt.name),
      );
      if (!matchingOpt) continue;

      for (const val of matchingOpt.values) {
        const baseMatch = baseOpt.values.find((v) => valuesLikelyMatch(v, val));
        if (baseMatch) {
          if (!optionPriceMaps.has(baseOpt.name)) {
            optionPriceMaps.set(baseOpt.name, new Map());
          }
          const priceMap = optionPriceMaps.get(baseOpt.name)!;
          if (!priceMap.has(baseMatch)) {
            priceMap.set(baseMatch, variantPrice);
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

// ---- Public variant enrichment helper ----

/**
 * Resolve per-variant prices for existing options using Exa search.
 * Wraps the private resolveVariantPricesViaExa with Exa client initialisation.
 * Returns baseOptions unchanged if EXA_API_KEY is not set.
 */
export async function enrichVariantPricesViaExa(
  productName: string,
  baseUrl: string,
  baseOptions: ProductOption[],
): Promise<ProductOption[]> {
  const exa = getExaClient();
  if (!exa || baseOptions.length === 0) return baseOptions;
  try {
    return await resolveVariantPricesViaExa(exa, productName, baseUrl, baseOptions);
  } catch {
    return baseOptions;
  }
}

// ---- Main entry point ----

export async function discoverViaExa(
  url: string,
): Promise<FullDiscoveryResult | null> {
  const exa = getExaClient();
  if (!exa) return null;

  try {
    console.log(`  [exa-extract] Fetching product data for ${url}`);

    const response = await Promise.race([
      exa.getContents([url], {
        summary: {
          query: "Extract product details as structured JSON",
          schema: PRODUCT_SCHEMA,
        },
        livecrawl: "always",
        livecrawlTimeout: EXA_LIVECRAWL_TIMEOUT_MS,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Exa extract timeout")), EXA_EXTRACT_TIMEOUT_MS),
      ),
    ]);

    const result = response.results?.[0];
    if (!result || !result.summary) {
      console.log(`  [exa-extract] No result or summary returned`);
      return null;
    }

    // Detect redirects — Exa may have crawled a different page
    if (isRedirectToOtherPage(url, result.url)) {
      console.log(`  [exa-extract] Redirect detected: requested ${url} but got ${result.url}`);
      return null;
    }

    let parsed: {
      name?: string;
      price?: string;
      original_price?: string;
      currency?: string;
      brand?: string;
      image_url?: string;
      product_description?: string;
      options?: string;
    };

    try {
      parsed = JSON.parse(result.summary);
    } catch {
      console.log(`  [exa-extract] Failed to parse summary JSON`);
      return null;
    }

    if (!parsed.name || !parsed.price) {
      console.log(`  [exa-extract] Missing name or price`);
      return null;
    }

    if (!isValidPrice(parsed.price)) {
      console.log(`  [exa-extract] Invalid price: ${parsed.price}`);
      return null;
    }

    let options = mapOptions(
      parseOptionsString(parsed.options).map((o) => ({
        name: o.name,
        values: o.values,
      })),
    );

    // Best-effort variant price resolution
    if (options.length > 0) {
      try {
        options = await resolveVariantPricesViaExa(exa, parsed.name, url, options);
      } catch (err) {
        console.log(
          `  [exa-extract] Variant resolution failed (swallowed): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(`  [exa-extract] Success: ${parsed.name} — ${parsed.price}`);

    return {
      name: parsed.name,
      price: stripCurrencySymbol(parsed.price),
      image_url: cleanExtractField(parsed.image_url),
      method: "exa",
      options,
      original_price: cleanExtractField(parsed.original_price)
        ? stripCurrencySymbol(parsed.original_price!)
        : undefined,
      currency: cleanExtractField(parsed.currency),
      description: cleanExtractField(parsed.product_description),
      brand: cleanExtractField(parsed.brand),
    };
  } catch (err) {
    if (err instanceof ProductNotFoundError) throw err;

    const message = err instanceof Error ? err.message : String(err);

    // Rate limit
    if (message.includes("429") || message.includes("rate limit")) {
      console.log(`  [exa-extract] Rate limited, skipping tier`);
      return null;
    }

    // Timeout
    if (message.includes("timeout")) {
      console.log(`  [exa-extract] Timeout, skipping tier`);
      return null;
    }

    console.log(`  [exa-extract] Error: ${message}`);
    return null;
  }
}
