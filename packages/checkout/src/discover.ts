import type { Page } from "playwright";
import {
  type ShippingInfo,
  type ProductOption,
  TomoError,
  ErrorCodes,
} from "@tomo/core";
import { discoverViaFirecrawl } from "@tomo/crawling";
import type { FullDiscoveryResult } from "@tomo/crawling";
import { createSession, destroySession } from "./session.js";
import { completeJson } from "./llm.js";

// ---- Price normalization ----
//
// Canonicalizes a raw extracted price string into a major-currency-unit dollar
// string with exactly 2 decimals (e.g. "49.99"). The order/receipt model carries
// dollar strings, so every price that leaves discovery MUST pass through here.
//
// ROOT-CAUSE NOTE (the "$49.99 stored as 4999" / 100x bug):
//   The LLM extraction prompt previously said `price` should be "digits only,
//   no currency symbol". The model obeyed literally and returned the price with
//   its decimal point removed ("49.99" -> "4999"). Nothing downstream restored
//   the point, so a $49.99 item was funded/quoted as $4999. The prompt is now
//   fixed to demand a decimal price, and this normalizer is the structural guard:
//   it treats schema.org / JSON-LD `price` (and any extracted price) as ALWAYS
//   being in MAJOR units (dollars) — it never divides by 100 on its own. A raw
//   value is only treated as integer cents when it arrives via an explicitly
//   cents-typed field; callers signal that with `{ unit: "cents" }`.
//
// Separator rules (locale-agnostic, no per-site logic):
//   - "$49.99"      -> "49.99"   (US/standard)
//   - "49,99"       -> "49.99"   (EU decimal comma)
//   - "1,234.56"    -> "1234.56" (US thousands comma + dot decimal)
//   - "1.234,56"    -> "1234.56" (EU thousands dot + comma decimal)
//   - "4999"        -> "4999.00" (no separators: an integer number of dollars)
//
// Rejects silent zeros: if a non-empty raw string normalizes to 0, that is an
// extraction failure (returns null) rather than a misleading "0.00".

export interface NormalizePriceOptions {
  /** "dollars" (default) treats the value as major units; "cents" divides by 100. */
  unit?: "dollars" | "cents";
}

/** Extract the numeric magnitude (as a JS number in dollars) from a raw price. */
function parsePriceMagnitude(raw: string): number | null {
  // Keep only digits and the two possible separators.
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");

  let normalized: string;
  if (hasDot && hasComma) {
    // Both present: the separator that appears LAST is the decimal separator;
    // the other is the thousands separator and is stripped.
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot) {
      // EU style "1.234,56" -> dot=thousands, comma=decimal
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US style "1,234.56" -> comma=thousands, dot=decimal
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Only commas. A single comma with 1-2 trailing digits is an EU decimal
    // comma ("49,99"); otherwise commas are thousands separators ("1,234").
    const m = /^(\d+),(\d{1,2})$/.exec(cleaned);
    normalized = m ? `${m[1]}.${m[2]}` : cleaned.replace(/,/g, "");
  } else {
    // Only dots (or none). A single dot is a decimal point; multiple dots are
    // thousands separators ("1.234.567" -> "1234567").
    const dotCount = (cleaned.match(/\./g) ?? []).length;
    normalized = dotCount > 1 ? cleaned.replace(/\./g, "") : cleaned;
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * Canonicalize a raw price into a 2-decimal dollar string, or null if the input
 * is empty / unparseable / normalizes to zero from non-empty input.
 */
export function normalizePrice(
  raw: string | number | null | undefined,
  options: NormalizePriceOptions = {},
): string | null {
  if (raw == null) return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;

  const magnitude = parsePriceMagnitude(rawStr);
  if (magnitude == null) return null;

  const dollars = options.unit === "cents" ? magnitude / 100 : magnitude;

  // A non-empty raw string that resolves to 0 is an extraction failure, not a
  // legitimate free item — avoid producing a silent "0.00".
  if (!(dollars > 0)) return null;

  return dollars.toFixed(2);
}

/**
 * Like normalizePrice but throws PRICE_EXTRACTION_FAILED instead of returning
 * null — for call sites that must produce a price or fail loudly.
 */
export function normalizePriceOrThrow(
  raw: string | number | null | undefined,
  options: NormalizePriceOptions = {},
): string {
  const normalized = normalizePrice(raw, options);
  if (normalized == null) {
    throw new TomoError(
      ErrorCodes.PRICE_EXTRACTION_FAILED,
      `Could not normalize extracted price: ${JSON.stringify(raw)}`,
    );
  }
  return normalized;
}

// ---- Discovery result ----

export interface DiscoveryResult {
  name: string;
  price: string;
  tax?: string;
  shipping?: string;
  total?: string;
  method: "scrape" | "browserbase_cart";
  image_url?: string;
}

export interface DiscoveryResultWithOptions extends DiscoveryResult {
  options: ProductOption[];
}

// Re-export FullDiscoveryResult from crawling for consumers
export type { FullDiscoveryResult } from "@tomo/crawling";

// ---- Tier 1: Server-side scrape (JSON-LD + meta tags) ----

export function extractJsonLd(html: string): Record<string, unknown> | null {
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]!) as Record<string, unknown>;

      // Direct Product type
      if (data["@type"] === "Product") return data;

      // @graph array
      if (Array.isArray(data["@graph"])) {
        const product = (data["@graph"] as Record<string, unknown>[]).find(
          (item) => item["@type"] === "Product",
        );
        if (product) return product;
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null;
}

export function extractMetaTag(html: string, property: string): string | null {
  // Match both property= and name= attributes
  const regex = new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const match = regex.exec(html);
  if (match) return match[1] || null;

  // Also check reversed attribute order (content before property)
  const regexReversed = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const matchReversed = regexReversed.exec(html);
  return matchReversed ? matchReversed[1] || null : null;
}

export async function scrapePrice(
  url: string,
): Promise<DiscoveryResult | null> {
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }

  // Try JSON-LD first
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    const name = (jsonLd["name"] as string) || "";
    let price: string | null = null;
    const image = (jsonLd["image"] as string) || undefined;

    // Extract price from offers (may be object or array)
    let offersObj = jsonLd["offers"] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    if (Array.isArray(offersObj)) {
      offersObj = offersObj[0];
    }
    if (offersObj) {
      if (
        typeof offersObj["price"] === "string" ||
        typeof offersObj["price"] === "number"
      ) {
        price = String(offersObj["price"]);
      } else if (
        typeof offersObj["lowPrice"] === "string" ||
        typeof offersObj["lowPrice"] === "number"
      ) {
        price = String(offersObj["lowPrice"]);
      }
    }

    if (name && price) {
      const normalized = normalizePrice(price);
      if (normalized) {
        return { name, price: normalized, method: "scrape", image_url: image };
      }
    }
  }

  // Try OG / product meta tags
  const ogTitle = extractMetaTag(html, "og:title");
  const ogPrice =
    extractMetaTag(html, "product:price:amount") ||
    extractMetaTag(html, "og:price:amount");
  const ogImage = extractMetaTag(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const price = normalizePrice(ogPrice);
    if (price) {
      return { name: ogTitle, price, method: "scrape", image_url: ogImage };
    }
  }

  return null;
}

// ---- Variant price helpers ----

/** Strip characters that could be used for prompt injection in option values. */
export function sanitizeVariantValue(value: string): string {
  return value.replace(/[<>"'&;]/g, "").slice(0, 100);
}

/** Dismiss common popups/modals via DOM manipulation (no LLM cost). */
export async function dismissPopupsOnPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const closeSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '[data-testid="close-button"]',
      ".modal-close",
      ".popup-close",
      'button[class*="close"]',
      '[data-dismiss="modal"]',
    ];
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el) (el as HTMLElement).click();
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

// ---- Tier 3: Local Playwright render + OpenRouter extraction ----

interface ExtractedProduct {
  name?: string;
  price?: string;
  original_price?: string;
  currency?: string;
  brand?: string;
  image_url?: string;
  options?: Array<{ name: string; values: string[] }>;
}

const PRODUCT_EXTRACT_SYSTEM =
  "You extract product data from an e-commerce product page. Return a JSON object: " +
  '{"name": string, "price": string (the price in major currency units, e.g. ' +
  '"49.99" for forty-nine dollars and ninety-nine cents — KEEP the decimal point ' +
  "and cents exactly as shown; do NOT strip the decimal point or convert to cents), " +
  '"original_price"?: string (same format), "currency"?: string, "brand"?: string, ' +
  '"image_url"?: string, "options"?: [{"name": string, "values": string[]}]}. ' +
  "Extract the ONE-TIME (non-subscription) price. Return ONLY the JSON object.";

function mapExtractedOptions(
  options: Array<{ name: string; values: string[] }> | undefined,
): ProductOption[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((o) => o && typeof o.name === "string" && Array.isArray(o.values))
    .map((o) => ({ name: o.name, values: o.values.map(String) }));
}

export async function discoverViaBrowser(
  url: string,
): Promise<FullDiscoveryResult | null> {
  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession({ headless: true });
  } catch {
    return null;
  }

  try {
    const page = session.page;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    await dismissPopupsOnPage(page).catch(() => {});

    // Pure tier first: JSON-LD in the rendered HTML
    const html = await page.content();
    const jsonLd = extractJsonLd(html);
    if (jsonLd) {
      const name = (jsonLd["name"] as string) || "";
      let price: string | null = null;
      const image = (jsonLd["image"] as string) || undefined;
      let offersObj = jsonLd["offers"] as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined;
      if (Array.isArray(offersObj)) offersObj = offersObj[0];
      if (offersObj) {
        const p = offersObj["price"] ?? offersObj["lowPrice"];
        if (typeof p === "string" || typeof p === "number") price = String(p);
      }
      if (name && price) {
        // schema.org `price` is always in major units (dollars); normalize and
        // bail to the LLM tier rather than emit a bad/zero price.
        const normalized = normalizePrice(price);
        if (normalized) {
          return {
            name,
            price: normalized,
            image_url: image,
            method: "browser",
            options: [],
          };
        }
      }
    }

    // LLM tier: extract from visible text
    const text = await page.evaluate(
      () => document.body?.innerText?.slice(0, 20000) ?? "",
    );
    const parsed = await completeJson<ExtractedProduct>(
      PRODUCT_EXTRACT_SYSTEM,
      `Product page text:\n${text}`,
    );

    if (
      !parsed?.name ||
      !parsed?.price ||
      parsed.name === "null" ||
      parsed.price === "null"
    ) {
      return null;
    }

    // Normalize the LLM-extracted price. If it can't be turned into a positive
    // dollar amount (e.g. the model emitted garbage), treat discovery as failed
    // rather than passing a zero/raw value downstream into a real card.
    const price = normalizePrice(parsed.price);
    if (!price) return null;

    return {
      name: parsed.name,
      price,
      image_url:
        parsed.image_url && parsed.image_url !== "null"
          ? parsed.image_url
          : undefined,
      method: "browser",
      options: mapExtractedOptions(parsed.options),
      original_price: parsed.original_price
        ? normalizePrice(parsed.original_price) ?? undefined
        : undefined,
      currency: parsed.currency,
      brand: parsed.brand,
    };
  } catch {
    return null;
  } finally {
    await destroySession(session);
  }
}

// ---- Per-variant price fetch (degraded) ----
//
// Upstream resolved each variant's price by driving a Stagehand agent to click
// the swatch and re-read the price. That agent path is gone; per-variant price
// resolution is now a no-op (base price is used for all variants). The exports
// are preserved for API compatibility.

/** Degraded: per-variant browser price resolution is not implemented locally. */
export async function fetchVariantPriceBrowser(
  _url: string,
  _optionName: string,
  _value: string,
): Promise<string | null> {
  return null;
}

/** Degraded: returns options unchanged (no per-variant price resolution). */
export async function resolveVariantPricesViaBrowser(
  _url: string,
  options: ProductOption[],
): Promise<ProductOption[]> {
  return options;
}

// ---- Browser cart discovery (degraded to render + extract) ----

export async function discoverViaCart(
  url: string,
  _shipping: ShippingInfo,
): Promise<DiscoveryResult> {
  const result = await discoverViaBrowser(url);
  if (!result) {
    throw new Error(
      "Price extraction failed: could not extract product via local browser render",
    );
  }
  return {
    name: result.name,
    price: result.price,
    method: "browserbase_cart",
    image_url: result.image_url,
  };
}

// ---- Main entry: Tier 1 → Tier 2 fallback ----

export async function discoverPrice(
  url: string,
  _shipping?: ShippingInfo,
): Promise<DiscoveryResult> {
  // Tier 1: Fast server-side scrape (JSON-LD / meta)
  const scraped = await scrapePrice(url);
  if (scraped) return scraped;

  // Tier 2: Local Playwright render + OpenRouter extraction
  const browsered = await discoverViaBrowser(url);
  if (browsered) {
    return {
      name: browsered.name,
      price: browsered.price,
      method: "browserbase_cart",
      image_url: browsered.image_url,
    };
  }

  throw new Error(
    "Price extraction failed: no structured data found and local render did not yield a price",
  );
}

// ---- Variant extraction from JSON-LD ----

export function extractVariantsFromJsonLd(
  jsonLd: Record<string, unknown>,
): ProductOption[] {
  const optionMap = new Map<string, Set<string>>();
  const priceMap = new Map<string, Map<string, string>>(); // optionName → (value → price)

  function processVariant(
    props: Record<string, unknown>[],
    price?: string,
  ): void {
    for (const prop of props) {
      const name = prop["name"] as string | undefined;
      const value = prop["value"] as string | undefined;
      if (name && value) {
        if (!optionMap.has(name)) optionMap.set(name, new Set());
        optionMap.get(name)!.add(value);

        // Track per-variant price (first-wins if same value at different prices)
        if (price) {
          if (!priceMap.has(name)) priceMap.set(name, new Map());
          const prices = priceMap.get(name)!;
          if (!prices.has(value)) {
            prices.set(value, price);
          }
        }
      }
    }
  }

  // Handle hasVariant array (Schema.org ProductModel)
  const variants = jsonLd["hasVariant"] as
    | Record<string, unknown>[]
    | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      const props = variant["additionalProperty"] as
        | Record<string, unknown>[]
        | undefined;
      const price =
        variant["price"] != null ? String(variant["price"]) : undefined;
      if (Array.isArray(props)) {
        processVariant(props, price);
      }
    }
  }

  // Handle offers array with additionalProperty (Shopify-style)
  let offers = jsonLd["offers"] as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | undefined;
  if (offers && !Array.isArray(offers)) offers = [offers];
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const props = offer["additionalProperty"] as
        | Record<string, unknown>[]
        | undefined;
      const price = offer["price"] != null ? String(offer["price"]) : undefined;
      if (Array.isArray(props)) {
        processVariant(props, price);
      }
    }
  }

  const result: ProductOption[] = [];
  for (const [name, values] of optionMap) {
    const prices = priceMap.get(name);
    // Only include prices if different values have different prices
    const priceValues = prices ? new Set(prices.values()) : new Set();
    const includePrices = prices && prices.size > 0 && priceValues.size > 1;
    result.push({
      name,
      values: [...values],
      prices: includePrices ? Object.fromEntries(prices) : undefined,
    });
  }
  return result;
}

// ---- Tier 1 with options: Server-side scrape + variant extraction ----

export async function scrapePriceWithOptions(
  url: string,
): Promise<DiscoveryResultWithOptions | null> {
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }

  let options: ProductOption[] = [];

  // Try JSON-LD first
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    options = extractVariantsFromJsonLd(jsonLd);

    const name = (jsonLd["name"] as string) || "";
    let price: string | null = null;
    const image = (jsonLd["image"] as string) || undefined;

    let offersObj = jsonLd["offers"] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    if (Array.isArray(offersObj)) {
      offersObj = offersObj[0];
    }
    if (offersObj) {
      if (
        typeof offersObj["price"] === "string" ||
        typeof offersObj["price"] === "number"
      ) {
        price = String(offersObj["price"]);
      } else if (
        typeof offersObj["lowPrice"] === "string" ||
        typeof offersObj["lowPrice"] === "number"
      ) {
        price = String(offersObj["lowPrice"]);
      }
    }

    if (name && price) {
      const normalized = normalizePrice(price);
      if (normalized) {
        return {
          name,
          price: normalized,
          method: "scrape",
          image_url: image,
          options,
        };
      }
    }
  }

  // Try OG / product meta tags
  const ogTitle = extractMetaTag(html, "og:title");
  const ogPrice =
    extractMetaTag(html, "product:price:amount") ||
    extractMetaTag(html, "og:price:amount");
  const ogImage = extractMetaTag(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const price = normalizePrice(ogPrice);
    if (price) {
      return {
        name: ogTitle,
        price,
        method: "scrape",
        image_url: ogImage,
        options,
      };
    }
  }

  return null;
}

// ---- Main discovery entry point: Firecrawl (static/render) → Scrape → Browser ----

export async function discoverProduct(
  url: string,
): Promise<FullDiscoveryResult> {
  // Primary: crawling discovery (static fetch → local render + OpenRouter, + Exa)
  const firecrawled = await discoverViaFirecrawl(url);
  if (firecrawled?.error === "product_not_found") return firecrawled;
  if (firecrawled) return firecrawled;

  // Tier 2: Server-side scrape with options (free, fast)
  const scraped = await scrapePriceWithOptions(url);
  if (scraped) {
    return {
      name: scraped.name,
      price: scraped.price,
      image_url: scraped.image_url,
      method: scraped.method,
      options: scraped.options,
    };
  }

  // Tier 3: Local Playwright render + OpenRouter extract
  const browsered = await discoverViaBrowser(url);
  if (browsered) return browsered;

  throw new Error(`Product discovery failed for ${url}: no structured data found`);
}
