import type { ProductOption } from "@bloon/core";
import type { FirecrawlExtract } from "./types.js";
import { stripCurrencySymbol } from "./helpers.js";

interface ShopifyVariant {
  title: string;
  price: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

interface ShopifyOption {
  name: string;
  values: string[];
}

interface ShopifyProduct {
  title: string;
  options: ShopifyOption[];
  variants: ShopifyVariant[];
  vendor?: string;
  body_html?: string;
  images?: Array<{ src: string }>;
}

function fetchShopifyJson(url: string): { cleanUrl: string } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.includes("/products/")) return null;
    const cleanUrl = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}.json`;
    return { cleanUrl };
  } catch {
    return null;
  }
}

function buildShopifyOptions(
  product: ShopifyProduct,
): ProductOption[] {
  const optionPriceMaps = new Map<string, Map<string, string>>();

  for (const variant of product.variants) {
    const price = stripCurrencySymbol(variant.price);
    const optionValues = [variant.option1, variant.option2, variant.option3];

    for (let i = 0; i < product.options.length; i++) {
      const optName = product.options[i]!.name;
      const val = optionValues[i];
      if (!val) continue;

      if (!optionPriceMaps.has(optName))
        optionPriceMaps.set(optName, new Map());
      const priceMap = optionPriceMaps.get(optName)!;
      if (!priceMap.has(val)) priceMap.set(val, price);
    }
  }

  return product.options.map((opt) => {
    const priceMap = optionPriceMaps.get(opt.name);
    if (!priceMap || priceMap.size === 0) {
      return { name: opt.name, values: opt.values };
    }

    const prices = Object.fromEntries(priceMap);
    // Same-price filter: if all prices identical, omit
    const uniquePrices = new Set(Object.values(prices));
    if (uniquePrices.size <= 1) {
      return { name: opt.name, values: opt.values };
    }

    return { name: opt.name, values: opt.values, prices };
  });
}

/**
 * Try fetching product options from the Shopify product JSON endpoint.
 * Shopify stores expose product data at `{product_url}.json`.
 * Returns null if the URL is not a Shopify product or the fetch fails.
 */
export async function fetchShopifyOptions(
  url: string,
): Promise<ProductOption[] | null> {
  try {
    const info = fetchShopifyJson(url);
    if (!info) return null;

    const response = await fetch(info.cleanUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { product?: ShopifyProduct };
    const product = body.product;
    if (!product?.options || product.options.length === 0) return null;

    return buildShopifyOptions(product);
  } catch {
    return null;
  }
}

/**
 * Try fetching full product data from the Shopify product JSON endpoint.
 * Returns a FirecrawlExtract-compatible object with name, price, options, etc.
 * Returns null if the URL is not a Shopify product or the fetch fails.
 */
export async function fetchShopifyProduct(
  url: string,
): Promise<FirecrawlExtract | null> {
  try {
    const info = fetchShopifyJson(url);
    if (!info) return null;

    const response = await fetch(info.cleanUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { product?: ShopifyProduct };
    const product = body.product;
    if (!product?.title || !product.variants?.[0]?.price) return null;

    const firstPrice = stripCurrencySymbol(product.variants[0].price);
    const options = product.options?.length > 0
      ? buildShopifyOptions(product)
      : [];

    // Strip HTML tags from body_html for description
    const description = product.body_html
      ? product.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
      : undefined;

    return {
      name: product.title,
      price: firstPrice,
      brand: product.vendor ?? undefined,
      image_url: product.images?.[0]?.src ?? undefined,
      description,
      currency: "USD",
      options: options.map((o) => ({
        name: o.name,
        values: o.values,
        prices: o.prices,
      })),
    };
  } catch {
    return null;
  }
}
