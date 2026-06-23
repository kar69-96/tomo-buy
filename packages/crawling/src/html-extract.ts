/**
 * Pure HTML → product extraction helpers (no network, no LLM).
 *
 * Shared by the static-fetch tier (extract.ts) and the Playwright-render tier
 * (browserbase-extract.ts). These cover the cheap, reliable paths: JSON-LD,
 * OpenGraph/product meta tags, schema.org microdata, and common price selectors.
 */

import TurndownService from "turndown";
import { load } from "cheerio";
import type { FirecrawlExtract } from "./types.js";
import { MAIN_CONTENT_SELECTORS, BOILERPLATE_SELECTORS } from "./constants.js";

function isProductType(type: unknown): boolean {
  if (typeof type === "string") {
    return (
      ["Product", "IndividualProduct", "ProductGroup"].includes(type) ||
      type.includes("schema.org/Product")
    );
  }
  if (Array.isArray(type)) return type.some((t) => isProductType(t));
  return false;
}

export function extractJsonLdFromHtml(html: string): FirecrawlExtract | null {
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]!) as Record<string, unknown>;
      const product = isProductType(data["@type"])
        ? data
        : Array.isArray(data["@graph"])
          ? (data["@graph"] as Record<string, unknown>[]).find((item) =>
              isProductType(item["@type"]),
            )
          : null;
      if (!product) continue;

      const name = product["name"] as string | undefined;
      let price: string | undefined;
      let currency: string | undefined;

      let offers = product["offers"] as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined;
      if (Array.isArray(offers)) offers = offers[0];
      if (offers) {
        if (offers["@type"] === "AggregateOffer") {
          if (offers["lowPrice"] != null) price = String(offers["lowPrice"]);
          else if (offers["price"] != null) price = String(offers["price"]);
        } else {
          if (offers["price"] != null) price = String(offers["price"]);
          else if (offers["lowPrice"] != null) price = String(offers["lowPrice"]);
        }
        currency = (offers["priceCurrency"] as string) ?? undefined;
      }

      if (name && price) {
        const image = typeof product["image"] === "string" ? product["image"] : undefined;
        const brand =
          typeof product["brand"] === "object" && product["brand"]
            ? ((product["brand"] as Record<string, unknown>)["name"] as string)
            : typeof product["brand"] === "string"
              ? product["brand"]
              : undefined;
        const description =
          typeof product["description"] === "string" ? product["description"] : undefined;

        return { name, price, currency, brand, image_url: image, description, options: [] };
      }
    } catch {
      // Invalid JSON, skip
    }
  }
  return null;
}

function extractMetaTagFromHtml(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const match = regex.exec(html);
  if (match) return match[1] || null;
  const regexReversed = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const matchReversed = regexReversed.exec(html);
  return matchReversed ? matchReversed[1] || null : null;
}

export function extractMetaFromHtml(html: string): FirecrawlExtract | null {
  const ogTitle = extractMetaTagFromHtml(html, "og:title");
  const ogPrice =
    extractMetaTagFromHtml(html, "product:price:amount") ||
    extractMetaTagFromHtml(html, "og:price:amount");
  const ogImage = extractMetaTagFromHtml(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const cleaned = ogPrice.trim().replace(/,/g, "");
    const match = /[\d]+\.?\d*/.exec(cleaned);
    if (match) {
      return { name: ogTitle, price: match[0], image_url: ogImage, options: [] };
    }
  }
  return null;
}

export function extractViaCssSelectors(html: string): FirecrawlExtract | null {
  const $ = load(html);

  // Strategy 1: Schema.org microdata (itemprop selectors)
  const itempropName = $('[itemprop="name"]').first().text().trim();
  const itempropPrice =
    $('[itemprop="price"]').first().attr("content") ||
    $('[itemprop="price"]').first().text().trim();

  if (itempropName && itempropPrice) {
    const priceMatch = /[\d,]+\.?\d*/.exec(itempropPrice.replace(/,/g, ""));
    if (priceMatch && parseFloat(priceMatch[0]) > 0) {
      const currency = $('[itemprop="priceCurrency"]').first().attr("content") || undefined;
      const image =
        $('[itemprop="image"]').first().attr("src") ||
        $('[itemprop="image"]').first().attr("content") ||
        undefined;
      const brand = $('[itemprop="brand"]').first().text().trim() || undefined;
      const desc = $('[itemprop="description"]').first().text().trim() || "";

      return {
        name: itempropName,
        price: priceMatch[0],
        currency,
        image_url: image,
        brand,
        description: desc ? desc.slice(0, 500) : undefined,
        options: [],
      };
    }
  }

  // Strategy 2: h1 + price class pattern
  const h1 = $("h1").first().text().trim();
  if (!h1) return null;

  const priceSelectors = [
    "[data-price]",
    '[data-testid*="price"]',
    '[aria-label*="price"]',
    '[data-automation-id*="price"]',
    ".price",
    "#price",
    '[class*="productPrice"]',
    '[class*="buybox"] [class*="price"]',
    '[class*="offer"] [class*="price"]',
    'span[class*="amount"]',
    '[class*="price"]:not([class*="compare"]):not([class*="original"]):not([class*="was"])',
  ];

  for (const sel of priceSelectors) {
    const $el = $(sel).first();
    const text = $el.attr("content") || $el.attr("data-price") || $el.text().trim();
    if (text) {
      const cleaned = text.replace(/[^0-9.,]/g, "").replace(/,/g, "");
      const match = /\d+\.?\d*/.exec(cleaned);
      if (match && parseFloat(match[0]) > 0) {
        return { name: h1, price: match[0], options: [] };
      }
    }
  }

  return null;
}

// ---- HTML → Markdown (for LLM extraction) ----

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.remove(["img", "iframe"]);

export function htmlToMarkdown(html: string): string {
  const $ = load(html);
  $("script, style, noscript, svg, meta, link").remove();

  for (const selector of MAIN_CONTENT_SELECTORS) {
    const $main = $(selector).first();
    if ($main.length) {
      const $clone = load($main.html()!);
      for (const bp of BOILERPLATE_SELECTORS) $clone(bp).remove();
      const md = turndown.turndown($clone.html()!);
      if (md.length >= 1_000) {
        return md.length > 30_000 ? md.slice(0, 30_000) : md;
      }
    }
  }

  for (const bp of BOILERPLATE_SELECTORS) $(bp).remove();
  const md = turndown.turndown($.html()!);
  return md.length > 30_000 ? md.slice(0, 30_000) : md;
}

/** Try all pure (no-LLM) extraction strategies in order. */
export function extractProductFromHtml(html: string): FirecrawlExtract | null {
  return (
    extractJsonLdFromHtml(html) ||
    extractMetaFromHtml(html) ||
    extractViaCssSelectors(html)
  );
}
