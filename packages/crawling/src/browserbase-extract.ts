/**
 * Browserbase fallback extraction: when Firecrawl's direct scrape fails
 * (bot-blocked), fetch rendered HTML via the Browserbase adapter, convert
 * to markdown, and extract product data using Gemini.
 *
 * Each call runs in full isolation — no shared queues or semaphores.
 * External services (Browserbase, Gemini) handle their own rate limiting.
 */

import TurndownService from "turndown";
import { load } from "cheerio";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import type { FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_PROMPT,
  ProductNotFoundError,
  ProductBlockedError,
  MAIN_CONTENT_SELECTORS,
  BOILERPLATE_SELECTORS,
  classifyContent,
} from "./constants.js";
import { isRedirectToOtherPage } from "./helpers.js";

const ADAPTER_PORT = parseInt(process.env.ADAPTER_PORT ?? "3003", 10);
const ADAPTER_BASE = `http://localhost:${ADAPTER_PORT}`;

const MIN_HTML_LENGTH = 500;

const GEMINI_EXTRACT_TIMEOUT_MS = parseInt(
  process.env.GEMINI_EXTRACT_TIMEOUT_MS ?? "20000",
  10,
);
const GEMINI_EXTRACT_RETRIES = parseInt(
  process.env.GEMINI_EXTRACT_RETRIES ?? "2",
  10,
);
export type BrowserbaseFailureCode =
  | "blocked"
  | "not_found"
  | "render_timeout"
  | "adapter_502"
  | "extract_empty"
  | "transport_error";

export interface BrowserbaseFailure {
  code: BrowserbaseFailureCode;
  detail?: string;
}

export interface BrowserbaseExtractResult {
  extract: FirecrawlExtract | null;
  failure: BrowserbaseFailure | null;
}

let lastBrowserbaseFailure: BrowserbaseFailure | null = null;

// ---- Step 1: Fetch rendered HTML from Browserbase adapter ----

export interface RenderedPage {
  html: string;
  finalUrl: string;
}

export async function fetchRenderedHtml(
  url: string,
  timeoutMs = 60_000,
): Promise<RenderedPage> {
  lastBrowserbaseFailure = null;
  const response = await fetch(`${ADAPTER_BASE}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  });

  if (!response.ok) {
    lastBrowserbaseFailure = {
      code: response.status === 502 ? "adapter_502" : "transport_error",
      detail: `adapter HTTP ${response.status}`,
    };
    throw new Error(`Adapter returned ${response.status}`);
  }

  const body = (await response.json()) as {
    content: string;
    pageStatusCode: number;
    pageError?: string;
    finalUrl?: string;
  };

  if (body.pageStatusCode === 404 || body.pageStatusCode === 410) {
    lastBrowserbaseFailure = {
      code: "not_found",
      detail: `browserbase page status ${body.pageStatusCode}`,
    };
    throw new ProductNotFoundError(`Page returned HTTP ${body.pageStatusCode}`);
  }
  if (body.pageStatusCode === 401 || body.pageStatusCode === 403 || body.pageStatusCode === 429) {
    lastBrowserbaseFailure = {
      code: "blocked",
      detail: `browserbase page status ${body.pageStatusCode}`,
    };
    throw new ProductBlockedError(`Page blocked with HTTP ${body.pageStatusCode}`);
  }
  if (body.pageStatusCode >= 400) {
    lastBrowserbaseFailure = {
      code: "transport_error",
      detail: `browserbase page status ${body.pageStatusCode}`,
    };
    throw new Error(`Page returned ${body.pageStatusCode}`);
  }

  const html = body.content ?? "";
  if (html.length < MIN_HTML_LENGTH) {
    lastBrowserbaseFailure = {
      code: "extract_empty",
      detail: `html too short (${html.length})`,
    };
    throw new Error(`HTML too short (${html.length} chars)`);
  }

  // Classify content for bot-blocking or not-found signals
  const classification = classifyContent(html, 20000);
  if (classification === "blocked") {
    lastBrowserbaseFailure = { code: "blocked", detail: "blocked pattern detected in rendered html" };
    throw new ProductBlockedError("Page still bot-blocked after Browserbase render");
  }
  if (classification === "not_found") {
    lastBrowserbaseFailure = { code: "not_found", detail: "not_found pattern detected in rendered html" };
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }

  return { html, finalUrl: body.finalUrl ?? url };
}

// ---- Step 2: HTML → Markdown ----

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.remove(["img", "iframe"]);

export function htmlToMarkdown(html: string): string {
  const $ = load(html);

  // Strip non-content tags
  $("script, style, noscript, svg, meta, link").remove();

  // Strategy 1: Try main-content selectors
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

  // Strategy 2: Full page with boilerplate removed
  for (const bp of BOILERPLATE_SELECTORS) $(bp).remove();
  const md = turndown.turndown($.html()!);

  return md.length > 30_000 ? md.slice(0, 30_000) : md;
}

// ---- Step 3: Gemini extraction ----

function getGeminiApiKey(): string {
  const key = process.env.GOOGLE_API_KEY_QUERY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY_QUERY or GOOGLE_API_KEY is required");
  return key;
}

const GEMINI_EXTRACT_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING, description: "Product name or title" },
    price: { type: SchemaType.STRING, description: "Current selling price" },
    original_price: { type: SchemaType.STRING, description: "Original price before discount" },
    currency: { type: SchemaType.STRING, description: "Currency code, e.g. USD, EUR" },
    brand: { type: SchemaType.STRING, description: "Brand or manufacturer" },
    image_url: { type: SchemaType.STRING, description: "Main product image URL" },
    description: { type: SchemaType.STRING, description: "Short product description" },
    options: {
      type: SchemaType.ARRAY,
      description: "ALL product variant option groups (Color, Size, Style, Material, etc.)",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          values: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
      },
    },
    variant_urls: {
      type: SchemaType.ARRAY,
      description: "URLs for other variants of this same product",
      items: { type: SchemaType.STRING },
    },
  },
};

let cachedGenAI: InstanceType<typeof GoogleGenerativeAI> | null = null;

function getGenAI(): InstanceType<typeof GoogleGenerativeAI> {
  if (!cachedGenAI) {
    cachedGenAI = new GoogleGenerativeAI(getGeminiApiKey());
  }
  return cachedGenAI;
}

async function extractWithGemini(markdown: string): Promise<FirecrawlExtract | null> {
  const model = getGenAI().getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_EXTRACT_SCHEMA,
    },
  });

  const prompt = `${FIRECRAWL_EXTRACT_PROMPT}\n\nPage content:\n${markdown}`;

  for (let attempt = 0; attempt <= GEMINI_EXTRACT_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Gemini extraction timeout")),
            GEMINI_EXTRACT_TIMEOUT_MS,
          ),
        ),
      ]);
      const text = result.response.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as FirecrawlExtract;
      } catch {
        return null;
      }
    } catch {
      if (attempt >= GEMINI_EXTRACT_RETRIES) return null;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

// ---- Orchestrator ----

export async function browserbaseExtract(
  url: string,
  timeoutMs = 90_000,
): Promise<FirecrawlExtract | null> {
  const { extract } = await browserbaseExtractWithFailure(url, timeoutMs);
  return extract;
}

// ---- Structured data extraction from rendered HTML ----

function isProductType(type: unknown): boolean {
  if (typeof type === "string") {
    return ["Product", "IndividualProduct", "ProductGroup"].includes(type)
      || type.includes("schema.org/Product");
  }
  if (Array.isArray(type)) return type.some((t) => isProductType(t));
  return false;
}

function extractJsonLdFromHtml(html: string): FirecrawlExtract | null {
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]!) as Record<string, unknown>;
      const product = isProductType(data["@type"])
        ? data
        : Array.isArray(data["@graph"])
          ? (data["@graph"] as Record<string, unknown>[]).find(
              (item) => isProductType(item["@type"]),
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
        const description = typeof product["description"] === "string" ? product["description"] : undefined;

        return {
          name,
          price,
          currency,
          brand,
          image_url: image,
          description,
          options: [],
        };
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

function extractMetaFromHtml(html: string): FirecrawlExtract | null {
  const ogTitle = extractMetaTagFromHtml(html, "og:title");
  const ogPrice =
    extractMetaTagFromHtml(html, "product:price:amount") ||
    extractMetaTagFromHtml(html, "og:price:amount");
  const ogImage = extractMetaTagFromHtml(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const cleaned = ogPrice.trim().replace(/,/g, "");
    const match = /[\d]+\.?\d*/.exec(cleaned);
    if (match) {
      return {
        name: ogTitle,
        price: match[0],
        image_url: ogImage,
        options: [],
      };
    }
  }
  return null;
}

function extractViaCssSelectors(html: string): FirecrawlExtract | null {
  const $ = load(html);

  // Strategy 1: Schema.org microdata (itemprop selectors)
  const itempropName = $('[itemprop="name"]').first().text().trim();
  const itempropPrice =
    $('[itemprop="price"]').first().attr("content")
    || $('[itemprop="price"]').first().text().trim();

  if (itempropName && itempropPrice) {
    const priceMatch = /[\d,]+\.?\d*/.exec(itempropPrice.replace(/,/g, ""));
    if (priceMatch && parseFloat(priceMatch[0]) > 0) {
      const currency =
        $('[itemprop="priceCurrency"]').first().attr("content") || undefined;
      const image =
        $('[itemprop="image"]').first().attr("src")
        || $('[itemprop="image"]').first().attr("content")
        || undefined;
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
    const text =
      $el.attr("content") || $el.attr("data-price") || $el.text().trim();
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

export async function browserbaseExtractWithFailure(
  url: string,
  timeoutMs = 90_000,
): Promise<BrowserbaseExtractResult> {
  try {
    console.log(`  [browserbase-extract] Fetching rendered HTML for ${url}`);
    const { html, finalUrl } = await fetchRenderedHtml(url, timeoutMs);

    // Fix 4: Detect redirects to different pages
    if (isRedirectToOtherPage(url, finalUrl)) {
      console.log(`  [browserbase-extract] Redirected to different page: ${finalUrl}`);
      const failure: BrowserbaseFailure = {
        code: "extract_empty",
        detail: `redirected from ${url} to ${finalUrl}`,
      };
      lastBrowserbaseFailure = failure;
      return { extract: null, failure };
    }

    // Fix 3: Try JSON-LD / meta tag extraction from rendered HTML first (fast, reliable)
    const jsonLdExtract = extractJsonLdFromHtml(html);
    if (jsonLdExtract?.name && jsonLdExtract?.price) {
      console.log(`  [browserbase-extract] JSON-LD success: ${jsonLdExtract.name} — ${jsonLdExtract.price}`);
      return { extract: jsonLdExtract, failure: null };
    }

    const metaExtract = extractMetaFromHtml(html);
    if (metaExtract?.name && metaExtract?.price) {
      console.log(`  [browserbase-extract] Meta tag success: ${metaExtract.name} — ${metaExtract.price}`);
      return { extract: metaExtract, failure: null };
    }

    // Try CSS selector extraction (itemprop, h1+price patterns)
    const cssExtract = extractViaCssSelectors(html);
    if (cssExtract?.name && cssExtract?.price) {
      console.log(`  [browserbase-extract] CSS selector success: ${cssExtract.name} — ${cssExtract.price}`);
      return { extract: cssExtract, failure: null };
    }

    // Fall back to Gemini markdown extraction
    console.log(`  [browserbase-extract] Converting HTML to markdown (${html.length} chars)`);
    const markdown = htmlToMarkdown(html);

    console.log(`  [browserbase-extract] Extracting product data via Gemini (${markdown.length} chars)`);
    const extract = await extractWithGemini(markdown);

    if (!extract?.name || !extract?.price) {
      const failure: BrowserbaseFailure = {
        code: "extract_empty",
        detail: "gemini returned no name/price",
      };
      lastBrowserbaseFailure = failure;
      console.log(`  [browserbase-extract] Gemini extraction returned no name/price`);
      return { extract: null, failure };
    }

    console.log(`  [browserbase-extract] Success: ${extract.name} — ${extract.price}`);
    return { extract, failure: null };
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof ProductBlockedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    let failure: BrowserbaseFailure;
    if (message.includes("timeout")) {
      failure = { code: "render_timeout", detail: message };
    } else if (message.includes("Adapter returned 502")) {
      failure = { code: "adapter_502", detail: message };
    } else {
      failure = lastBrowserbaseFailure ?? { code: "transport_error", detail: message };
    }
    lastBrowserbaseFailure = failure;
    console.log(`  [browserbase-extract] Failed: ${message}`);
    return { extract: null, failure };
  }
}
