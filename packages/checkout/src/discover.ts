import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import {
  BloonError,
  ErrorCodes,
  type ShippingInfo,
  type ProductOption,
} from "@bloon/core";
import {
  discoverViaFirecrawl,
  stripCurrencySymbol,
  extractPriceFromString,
} from "@bloon/crawling";
import type { FullDiscoveryResult } from "@bloon/crawling";
import {
  createSession,
  destroySession,
  getModelApiKey,
  getQueryModelApiKey,
  getBrowserbaseConfig,
} from "./session.js";
import { sanitizeShipping } from "./credentials.js";
import { concurrencyPool } from "./concurrency-pool.js";
import { CostTracker } from "./cost-tracker.js";


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
export type { FullDiscoveryResult } from "@bloon/crawling";

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
      return { name, price, method: "scrape", image_url: image };
    }
  }

  // Try OG / product meta tags
  const ogTitle = extractMetaTag(html, "og:title");
  const ogPrice =
    extractMetaTag(html, "product:price:amount") ||
    extractMetaTag(html, "og:price:amount");
  const ogImage = extractMetaTag(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const price = extractPriceFromString(ogPrice);
    if (price) {
      return { name: ogTitle, price, method: "scrape", image_url: ogImage };
    }
  }

  return null;
}

// ---- Variant price helpers ----

const VariantPriceSchema = z.object({
  price: z
    .string()
    .describe("Currently displayed product price including currency symbol"),
});

/** Strip characters that could be used for prompt injection in option values. */
export function sanitizeVariantValue(value: string): string {
  return value.replace(/[<>"'&;]/g, "").slice(0, 100);
}

/** Dismiss common popups/modals via DOM manipulation (no LLM cost). */
export async function dismissPopupsOnPage(
  page: NonNullable<
    Awaited<ReturnType<InstanceType<typeof Stagehand>["context"]["activePage"]>>
  >,
): Promise<void> {
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

// ---- Tier 3: Browserbase product discovery via Stagehand extract ----

const BrowserProductSchema = z.object({
  name: z.string().describe("Product name or title"),
  price: z.string().describe("Current selling price including currency symbol"),
  original_price: z
    .string()
    .optional()
    .describe("Original price before discount"),
  currency: z.string().optional().describe("Currency code, e.g. USD, EUR"),
  brand: z.string().optional().describe("Brand or manufacturer"),
  image_url: z.string().optional().describe("Main product image URL"),
  options: z
    .array(
      z.object({
        name: z.string().describe("Option group name, e.g. Color, Size"),
        values: z.array(z.string()).describe("Available values"),
        prices: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Map value→price if different values have different prices",
          ),
      }),
    )
    .optional()
    .describe("ALL product variant options"),
});

export async function discoverViaBrowser(
  url: string,
): Promise<FullDiscoveryResult | null> {
  // Guard: need Browserbase + query model API keys
  try {
    getBrowserbaseConfig();
    getQueryModelApiKey();
  } catch {
    return null;
  }

  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession();
  } catch {
    return null;
  }

  const discoverTracker = new CostTracker();
  const sessionStartMs = Date.now();
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  let sessionDestroyed = false;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: getQueryModelApiKey(),
      },
      browserbaseSessionID: session.id,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(3000);
    await dismissPopupsOnPage(page);
    await page.waitForTimeout(500);

    const extractStart = Date.now();
    const extracted = await stagehand.extract(
      "Extract the product name, current price, original price (if on sale), currency, brand, main image URL, and all variant options (like Color, Size) with their available values and per-value prices if different",
      BrowserProductSchema,
    );
    discoverTracker.addLLMCall(
      "discover/extract",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - extractStart,
    );

    // Validate minimum required fields (LLM may return literal "null" string)
    if (
      !extracted.name ||
      !extracted.price ||
      extracted.name === "null" ||
      extracted.price === "null"
    ) {
      return null;
    }

    // Map options with currency-stripped prices
    let options: ProductOption[] = (extracted.options ?? []).map((opt) => ({
      name: opt.name,
      values: opt.values,
      prices: opt.prices
        ? Object.fromEntries(
            Object.entries(opt.prices).map(([k, v]) => [
              k,
              stripCurrencySymbol(v),
            ]),
          )
        : undefined,
    }));

    // Close initial session early before spawning concurrent variant fetches
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    stagehand = undefined;
    await destroySession(session.id);
    sessionDestroyed = true;

    // Resolve per-variant prices via concurrent Browserbase sessions (best-effort)
    if (options.length > 0) {
      try {
        options = await resolveVariantPricesViaBrowser(url, options);
      } catch {
        // Variant resolution is best-effort — keep original options
      }
    }

    return {
      name: extracted.name,
      price: stripCurrencySymbol(extracted.price),
      image_url:
        extracted.image_url && extracted.image_url !== "null"
          ? extracted.image_url
          : undefined,
      method: "browserbase",
      options,
      original_price: extracted.original_price
        ? stripCurrencySymbol(extracted.original_price)
        : undefined,
      currency: extracted.currency,
      brand: extracted.brand,
    };
  } catch {
    return null;
  } finally {
    discoverTracker.addSession(session.id, Date.now() - sessionStartMs);
    discoverTracker.printSummary();
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        /* ignore */
      }
    }
    if (!sessionDestroyed) {
      await destroySession(session.id);
    }
  }
}

// ---- Per-variant price fetch via Browserbase ----

const VARIANT_AGENT_SYSTEM_PROMPT = `You are selecting a product variant on an e-commerce website.

Your task:
1. Find the correct variant selector for the requested option (e.g. Color, Size, Style)
2. Select the requested value
3. Report the updated product price

CRITICAL RULES:
- NEVER interact with the quantity selector or "Qty" dropdown — that is NOT a variant
- Look for variant selectors: color swatches, size buttons, labeled dropdowns
  in the product details/options area
- Variant selectors are usually near the product title and price, labeled with
  their option name (e.g. "Color:", "Size:", "Style:")
- After selecting, wait for the price to update, then report it`;

/** Fetch a single variant's price in a fresh Browserbase session. */
export async function fetchVariantPriceBrowser(
  url: string,
  optionName: string,
  value: string,
): Promise<string | null> {
  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession();
  } catch {
    return null;
  }

  const variantTracker = new CostTracker();
  const sessionStartMs = Date.now();
  let stagehand: InstanceType<typeof Stagehand> | undefined;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: getQueryModelApiKey(),
      },
      browserbaseSessionID: session.id,
      experimental: true,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(3000);
    await dismissPopupsOnPage(page);

    const agent = stagehand.agent({
      mode: "dom",
      systemPrompt: VARIANT_AGENT_SYSTEM_PROMPT,
    });

    const safeName = sanitizeVariantValue(optionName);
    const safeValue = sanitizeVariantValue(value);
    const agentStart = Date.now();

    const result = await agent.execute({
      instruction: `Select the "${safeName}" variant with value "${safeValue}". Then report the currently displayed product price.`,
      maxSteps: 8,
      output: VariantPriceSchema,
    });

    const resultUsage = result.usage;
    if (resultUsage?.input_tokens || resultUsage?.output_tokens) {
      variantTracker.addLLMCall(
        `variant/${safeValue.slice(0, 20)}`,
        resultUsage.input_tokens ?? 0,
        resultUsage.output_tokens ?? 0,
        "google/gemini-2.0-flash",
        Date.now() - agentStart,
      );
    }

    const output = result.output;
    if (!output?.price || output.price === "null") return null;
    return stripCurrencySymbol(String(output.price));
  } catch {
    return null;
  } finally {
    variantTracker.addSession(session.id, Date.now() - sessionStartMs);
    variantTracker.printSummary();
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        /* ignore */
      }
    }
    await destroySession(session.id);
  }
}

/** Max variants to resolve per option group (e.g. 5 out of 30 colors). */
const MAX_VARIANTS_PER_GROUP = parseInt(
  process.env.QUERY_MAX_VARIANTS_PER_GROUP ?? "3",
  10,
);
const MAX_TOTAL_VARIANT_TASKS = parseInt(
  process.env.QUERY_MAX_TOTAL_VARIANT_TASKS ?? "10",
  10,
);

/** Resolve per-variant prices via concurrent Browserbase sessions. */
export async function resolveVariantPricesViaBrowser(
  url: string,
  options: ProductOption[],
  concurrency = parseInt(process.env.QUERY_VARIANT_CONCURRENCY ?? "3", 10),
): Promise<ProductOption[]> {
  // Build task list: flatten option groups into { optionName, value } pairs
  // Cap per group to avoid spawning dozens of sessions for products with many variants
  const tasks: Array<{ optionName: string; value: string }> = [];
  for (const opt of options) {
    // Skip groups where all values already have prices
    if (opt.prices && opt.values.every((v) => opt.prices![v] != null)) continue;
    let count = 0;
    for (const value of opt.values) {
      // Skip individual values that already have a price
      if (opt.prices?.[value] != null) continue;
      if (count >= MAX_VARIANTS_PER_GROUP) break;
      if (tasks.length >= MAX_TOTAL_VARIANT_TASKS) break;
      tasks.push({ optionName: opt.name, value });
      count++;
    }
    if (tasks.length >= MAX_TOTAL_VARIANT_TASKS) break;
  }

  if (tasks.length === 0) return options;

  const results = await concurrencyPool(
    tasks,
    (task) => fetchVariantPriceBrowser(url, task.optionName, task.value),
    concurrency,
  );

  // Build price maps from fulfilled results
  const priceMaps = new Map<string, Map<string, string>>();
  for (let i = 0; i < tasks.length; i++) {
    const result = results[i]!;
    if (result.status === "fulfilled" && result.value != null) {
      const task = tasks[i]!;
      if (!priceMaps.has(task.optionName))
        priceMaps.set(task.optionName, new Map());
      priceMaps.get(task.optionName)!.set(task.value, result.value);
    }
  }

  // Merge into options
  return options.map((opt) => {
    const resolved = priceMaps.get(opt.name);
    if (!resolved || resolved.size === 0) return opt;
    // Combine existing prices with resolved ones
    const merged: Record<string, string> = { ...(opt.prices ?? {}) };
    for (const [value, price] of resolved) {
      merged[value] = price;
    }
    // Same-price filter: if all prices are identical, omit the map
    const uniquePrices = new Set(Object.values(merged));
    if (uniquePrices.size <= 1) return { ...opt, prices: undefined };
    return { ...opt, prices: merged };
  });
}

// ---- Browserbase cart discovery via Stagehand ----

const CartPricingSchema = z.object({
  name: z.string().describe("Product name"),
  price: z.string().describe("Product price without currency symbol"),
  tax: z.string().optional().describe("Tax amount"),
  shipping: z.string().optional().describe("Shipping cost"),
  total: z.string().optional().describe("Order total"),
});

export async function discoverViaCart(
  url: string,
  shipping: ShippingInfo,
): Promise<DiscoveryResult> {
  const modelApiKey = getModelApiKey();
  const session = await createSession();
  const cartTracker = new CostTracker();
  const sessionStartMs = Date.now();
  let stagehand: InstanceType<typeof Stagehand> | undefined;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: modelApiKey,
      },
      browserbaseSessionID: session.id,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(3000);

    let actStart = Date.now();
    await stagehand.act("Add this product to cart");
    cartTracker.addLLMCall(
      "cart/add-to-cart",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - actStart,
    );
    await page.waitForTimeout(1000);

    actStart = Date.now();
    await stagehand.act("Go to cart or proceed to checkout");
    cartTracker.addLLMCall(
      "cart/go-to-checkout",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - actStart,
    );
    await page.waitForTimeout(2000);

    // Fill shipping if applicable (sanitize to prevent prompt injection)
    const safe = sanitizeShipping(shipping);
    try {
      actStart = Date.now();
      await stagehand.act(
        "Fill shipping information: name=%x_shipping_name%, street=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, country=%x_shipping_country%, email=%x_shipping_email%, phone=%x_shipping_phone%",
        {
          variables: {
            x_shipping_name: safe.name,
            x_shipping_street: safe.street,
            x_shipping_city: safe.city,
            x_shipping_state: safe.state,
            x_shipping_zip: safe.zip,
            x_shipping_country: safe.country,
            x_shipping_email: safe.email,
            x_shipping_phone: safe.phone,
          },
        },
      );
      cartTracker.addLLMCall(
        "cart/fill-shipping",
        0,
        0,
        "google/gemini-2.5-flash",
        Date.now() - actStart,
      );
      await page.waitForTimeout(1000);
    } catch {
      // Shipping form may not be visible yet
    }

    const extractStart = Date.now();
    const pricing = await stagehand.extract(
      "Extract the product name, price, tax, shipping cost, and order total from this cart/checkout page",
      CartPricingSchema,
    );
    cartTracker.addLLMCall(
      "cart/extract-pricing",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - extractStart,
    );

    // Strip currency symbols from extracted values
    const stripCurrency = (v: string | undefined): string | undefined =>
      v ? v.replace(/^[^\d]*/, "").replace(/[^\d.]/g, "") || v : v;

    return {
      name: pricing.name,
      price: stripCurrency(pricing.price) || pricing.price,
      tax: stripCurrency(pricing.tax),
      shipping: stripCurrency(pricing.shipping),
      total: stripCurrency(pricing.total),
      method: "browserbase_cart",
    };
  } finally {
    cartTracker.addSession(session.id, Date.now() - sessionStartMs);
    cartTracker.printSummary();
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        /* ignore */
      }
    }
    await destroySession(session.id);
  }
}

// ---- Main entry: Tier 1 → Tier 2 fallback ----

export async function discoverPrice(
  url: string,
  shipping?: ShippingInfo,
): Promise<DiscoveryResult> {
  // Tier 1: Fast server-side scrape
  const scraped = await scrapePrice(url);
  if (scraped) return scraped;

  // Tier 2: Browserbase cart (requires shipping)
  if (!shipping) {
    throw new Error(
      "Price extraction failed: no structured data found and no shipping info provided for cart discovery",
    );
  }

  return discoverViaCart(url, shipping);
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
      return { name, price, method: "scrape", image_url: image, options };
    }
  }

  // Try OG / product meta tags
  const ogTitle = extractMetaTag(html, "og:title");
  const ogPrice =
    extractMetaTag(html, "product:price:amount") ||
    extractMetaTag(html, "og:price:amount");
  const ogImage = extractMetaTag(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const cleaned = ogPrice.trim().replace(/,/g, "");
    const match = /[\d]+\.?\d*/.exec(cleaned);
    if (match) {
      return {
        name: ogTitle,
        price: match[0],
        method: "scrape",
        image_url: ogImage,
        options,
      };
    }
  }

  return null;
}

// ---- Main discovery entry point: Firecrawl (primary) → Scrape (fallback) → Browserbase ----

export async function discoverProduct(
  url: string,
): Promise<FullDiscoveryResult> {
  // Primary: Firecrawl (rich data + per-variant pricing)
  // discoverViaFirecrawl already fires Exa internally in parallel — no separate exaPromise needed.
  const firecrawled = await discoverViaFirecrawl(url);
  if (firecrawled?.error === "product_not_found") return firecrawled;
  if (firecrawled) return maybeResolveVariantPrices(url, firecrawled);

  // Tier 2: Server-side scrape (free, fast)
  const scraped = await scrapePriceWithOptions(url);
  if (scraped) {
    const result: FullDiscoveryResult = {
      name: scraped.name,
      price: scraped.price,
      image_url: scraped.image_url,
      method: scraped.method,
      options: scraped.options,
    };
    return maybeResolveVariantPrices(url, result);
  }

  // Tier 3: Browserbase headless Chrome + LLM extract
  // (discoverViaBrowser already calls resolveVariantPricesViaBrowser internally)
  const browsered = await discoverViaBrowser(url);
  if (browsered) return browsered;

  throw new BloonError(
    ErrorCodes.QUERY_FAILED,
    `Product discovery failed for ${url}: no structured data found`,
  );
}

/**
 * If a discovery result has options without variant prices, resolve them
 * via concurrent Browserbase sessions (Stagehand agent clicks each variant).
 */
async function maybeResolveVariantPrices(
  url: string,
  result: FullDiscoveryResult,
): Promise<FullDiscoveryResult> {
  const options = result.options;
  if (!options || options.length === 0) return result;

  // Check if any option group is missing prices
  const needsPriceResolution = options.some(
    (opt) => !opt.prices || Object.keys(opt.prices).length === 0,
  );
  if (!needsPriceResolution) return result;

  try {
    const resolved = await resolveVariantPricesViaBrowser(url, options);
    return { ...result, options: resolved };
  } catch {
    return result;
  }
}
