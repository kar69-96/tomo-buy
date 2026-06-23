/**
 * Exa.ai natural language product search.
 * Uses searchAndContents() to find products matching a query,
 * returning structured extraction in a single API call.
 */

import { getExaClient } from "./exa-client.js";
import { stripCurrencySymbol, isValidPrice, mapOptions, cleanExtractField } from "./helpers.js";
import type { ProductOption } from "@bloon/core";

// ---- Config ----

const EXA_SEARCH_TIMEOUT_MS = parseInt(
  process.env.EXA_SEARCH_TIMEOUT_MS ?? "20000",
  10,
);

const URL_CHECK_TIMEOUT_MS = parseInt(
  process.env.EXA_URL_CHECK_TIMEOUT_MS ?? "4000",
  10,
);

const DEFAULT_NUM_RESULTS = 15;

// ---- Schema (reuses structure from exa-extract) ----

const SEARCH_PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name or title" },
    price: { type: "string", description: "Current selling price with currency symbol" },
    original_price: { type: "string", description: "Original price before discount" },
    currency: { type: "string", description: "Currency code, e.g. USD, EUR" },
    brand: { type: "string", description: "Brand or manufacturer" },
    image_url: { type: "string", description: "Main product image URL" },
    options: {
      type: "string",
      description: 'JSON array of option groups, each with name (string) and values (string[]). Example: [{"name":"Color","values":["Red","Blue"]}]',
    },
  },
  required: ["name", "price"],
};

// ---- Types ----

export interface ExaSearchResult {
  readonly name: string;
  readonly url: string;
  readonly price: string;
  readonly original_price?: string;
  readonly currency?: string;
  readonly brand?: string;
  readonly image_url?: string;
  readonly options: readonly ProductOption[];
  readonly relevance_score: number;
}

export interface SearchProductsOptions {
  readonly includeDomains?: readonly string[];
  readonly numResults?: number;
}

// ---- Helpers ----

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

// ---- Retail page filter ----

/**
 * Domains that are never purchasable product pages.
 * Organised by category — Exa may extract a price from review text, making
 * them pass schema validation despite not being a storefront.
 */
const NON_RETAIL_DOMAINS = new Set<string>([
  // Tech review & editorial
  "wirecutter.com", "nytimes.com", "cnet.com", "techradar.com", "pcmag.com",
  "theverge.com", "engadget.com", "rtings.com", "tomshardware.com", "tomsguide.com",
  "gsmarena.com", "notebookcheck.net", "anandtech.com", "arstechnica.com",
  "digitaltrends.com", "wired.com", "gizmodo.com", "lifehacker.com",
  "zdnet.com", "techcrunch.com", "9to5mac.com", "macrumors.com", "appleinsider.com",
  "androidauthority.com", "xda-developers.com", "dpreview.com", "photographylife.com",

  // General media & listicles
  "buzzfeed.com", "businessinsider.com", "forbes.com", "fortune.com",
  "huffpost.com", "vox.com", "mashable.com", "fastcompany.com", "inc.com",
  "popsugar.com", "refinery29.com", "allure.com", "byrdie.com",

  // Home, lifestyle & editorial
  "thespruce.com", "bobvila.com", "familyhandyman.com", "thisoldhouse.com",
  "apartmenttherapy.com", "realsimple.com", "goodhousekeeping.com",
  "housebeautiful.com", "elledecor.com", "architecturaldigest.com",
  "foodnetwork.com", "seriouseats.com", "epicurious.com", "bonappetit.com",
  "tastingtable.com", "eatthis.com",

  // Health & wellness editorial
  "healthline.com", "medicalnewstoday.com", "webmd.com", "mayoclinic.org",
  "verywellhealth.com", "verywellfamily.com", "verywellfit.com",
  "menshealth.com", "womenshealthmag.com", "shape.com", "prevention.com",
  "self.com", "health.com", "everydayhealth.com",

  // Outdoor, gear & sports review
  "gearpatrol.com", "outdoorgearlab.com", "cleverhiker.com", "switchbacktravel.com",
  "runnerworld.com", "bicycling.com", "backpacker.com", "rei.com/learn",

  // Consumer review & ratings
  "consumerreports.org", "reviews.com", "bestreviews.com", "which.co.uk",
  "productreview.com.au", "choice.com.au", "trustpilot.com", "sitejabber.com",
  "yelp.com", "tripadvisor.com",

  // Deal, coupon & cash-back (link to retailers, not products themselves)
  "retailmenot.com", "coupons.com", "groupon.com", "slickdeals.net",
  "dealnews.com", "fatwallet.com", "rakuten.com", "ibotta.com",
  "honey.com", "joinhoney.com", "bradsdeals.com", "gottadeal.com",

  // Price trackers & comparison engines
  "camelcamelcamel.com", "pricespy.com", "getpricelist.com", "pricecharting.com",
  "google.com", "bing.com", "shopping.google.com",

  // Social & community (not storefronts)
  "reddit.com", "quora.com", "youtube.com", "pinterest.com",
  "instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com",
  "tumblr.com", "medium.com", "substack.com",

  // Encyclopedia & reference
  "wikipedia.org", "wikimedia.org", "wikihow.com",
]);

/**
 * Subdomain prefixes that indicate non-production environments.
 * Matches hostnames like uat-cd-us.cerave.com, staging.shop.com, dev.store.io.
 */
const STAGING_PREFIXES = [
  "uat-", "uat.", "staging.", "stg.", "stage.",
  "dev.", "develop.", "development.",
  "test.", "testing.",
  "qa.", "qat.",
  "preprod.", "pre-prod.", "pre.",
  "sandbox.", "demo.", "preview.",
  "local.", "localhost",
];

/**
 * URL path prefixes that unambiguously indicate non-product content.
 * Kept conservative — only patterns where no product purchase is possible.
 */
const EDITORIAL_PATH_PREFIXES = [
  "/reviews/", "/review/",
  "/blog/", "/blogs/",
  "/news/",
  "/article/", "/articles/",
  "/buying-guide", "/buying-guides",
  "/guide/", "/guides/",
  "/wiki/",
  "/forum/", "/forums/",
  "/community/",
  "/help/",
  "/compare/",
  "/versus/",
  "/best-of/",
];

/**
 * Returns true when the URL is a search-results page rather than a product page.
 * These pages list products but are not purchasable directly.
 */
function isSearchResultsUrl(parsed: URL): boolean {
  const path = parsed.pathname.toLowerCase();
  const params = parsed.searchParams;

  // Amazon search: /s or /anything/s with ?k= param
  if (params.has("k") && (path === "/s" || path.endsWith("/s"))) return true;

  // Generic search paths
  if (/^\/search(\/|$)/i.test(path)) return true;

  // Common search query params alongside a root or category path (not a product slug)
  // Only flag when the path itself isn't a product path (no /dp/, /products/, /p/, /item/)
  const hasProductSegment = /\/(dp|products?|p|item|buy|pd|detail|sku)\//i.test(path);
  if (!hasProductSegment) {
    if (params.has("q") || params.has("query") || params.has("s")) {
      // ?s= is a WordPress search, ?q= / ?query= are generic search params
      if (/^\/(s|search|results?)(\/|$)/i.test(path) || path === "/") return true;
    }
  }

  return false;
}

/**
 * Returns true if the URL looks like an actual purchasable retail product page.
 *
 * Three-layer filter:
 *  1. Domain blocklist  — editorial, review, social, deal, price-tracker, search-engine sites
 *  2. Staging detection — uat-*, staging.*, dev.*, etc.
 *  3. URL structure     — search-results pages and obvious editorial path prefixes
 */
export function isProductPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Must be HTTP/HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();

  // 1. Domain blocklist — covers full domain and all subdomains
  if (NON_RETAIL_DOMAINS.has(hostname)) return false;
  for (const blocked of NON_RETAIL_DOMAINS) {
    if (hostname.endsWith(`.${blocked}`)) return false;
  }

  // 2. Staging/UAT environments
  for (const prefix of STAGING_PREFIXES) {
    if (hostname.startsWith(prefix)) return false;
  }

  const path = parsed.pathname;

  // 3a. Search-results URL patterns
  if (isSearchResultsUrl(parsed)) return false;

  // 3b. Editorial/non-product path prefixes
  const pathLower = path.toLowerCase();
  for (const prefix of EDITORIAL_PATH_PREFIXES) {
    if (pathLower.startsWith(prefix)) return false;
  }

  return true;
}

// ---- URL reachability check ----

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ADAPTER_URL =
  process.env.BROWSERBASE_ADAPTER_URL ?? "http://localhost:3003";

const ADAPTER_SCRAPE_TIMEOUT_MS = parseInt(
  process.env.ADAPTER_SCRAPE_TIMEOUT_MS ?? "45000",
  10,
);

/**
 * Check URL reachability via the Browserbase adapter (stealth + proxy).
 * Used as a fallback when plain HTTP gets 403 (bot-blocked sites).
 * Returns true if adapter loads the page with status 200 and meaningful content.
 * Returns true (benefit of the doubt) if adapter is unavailable.
 */
async function isReachableViaBrowser(url: string): Promise<boolean> {
  try {
    const healthResp = await fetch(`${ADAPTER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!healthResp.ok) return true;
  } catch {
    // Adapter not running — benefit of the doubt
    return true;
  }

  try {
    const resp = await fetch(`${ADAPTER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, timeout: 30000 }),
      signal: AbortSignal.timeout(ADAPTER_SCRAPE_TIMEOUT_MS),
    });

    if (!resp.ok) return true;

    const data = (await resp.json()) as {
      pageStatusCode?: number;
      content?: string;
      pageError?: string;
    };

    if (data.pageStatusCode === 404 || data.pageStatusCode === 410) {
      console.log(`  [exa-search] Browserbase confirmed ${data.pageStatusCode} for ${url}`);
      return false;
    }

    const contentLen = data.content?.length ?? 0;
    if (data.pageStatusCode === 200 && contentLen > 500) {
      console.log(`  [exa-search] Browserbase verified reachable (${contentLen} chars): ${url}`);
      return true;
    }

    // Adapter returned something ambiguous — benefit of the doubt
    return true;
  } catch {
    // Adapter timeout or error — benefit of the doubt
    return true;
  }
}

/**
 * HEAD-checks a URL to filter out 404s and dead domains from Exa results.
 * Rejects on definitive "not found" signals (404, 410, ENOTFOUND, ECONNREFUSED).
 * On 403 or headers-overflow (bot-blocked), falls back to Browserbase adapter.
 * Keeps on timeout — Exa just crawled it, a slow response ≠ missing.
 */
export async function isUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });

    if (res.status === 404 || res.status === 410) return false;

    if (res.status === 403) {
      console.log(`  [exa-search] 403 on HEAD — trying Browserbase fallback: ${url}`);
      return isReachableViaBrowser(url);
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const causeCode = (err as any)?.cause?.code as string | undefined;

    if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      return false;
    }
    // Headers overflow = aggressive bot protection (e.g. Logitech, Corsair)
    // Node's fetch wraps this as "fetch failed" with cause.code = UND_ERR_HEADERS_OVERFLOW
    // These sites load fine in a real browser — verify via Browserbase
    if (causeCode === "UND_ERR_HEADERS_OVERFLOW") {
      console.log(`  [exa-search] Headers overflow — trying Browserbase fallback: ${url}`);
      return isReachableViaBrowser(url);
    }
    // Timeout (AbortError), SSL errors, etc. → keep (benefit of the doubt)
    return true;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Main search function ----

export async function searchProducts(
  query: string,
  options?: SearchProductsOptions,
): Promise<readonly ExaSearchResult[]> {
  const exa = getExaClient();
  if (!exa) {
    throw new Error("EXA_API_KEY not set");
  }

  const numResults = options?.numResults ?? DEFAULT_NUM_RESULTS;
  const includeDomains = options?.includeDomains
    ? [...options.includeDomains]
    : undefined;

  console.log(`  [exa-search] Searching: "${query}" (domains: ${includeDomains?.join(", ") ?? "any"}, limit: ${numResults})`);

  const searchResult = await Promise.race([
    exa.searchAndContents(query, {
      ...(includeDomains && includeDomains.length > 0
        ? { includeDomains }
        : {}),
      numResults,
      type: "neural",
      summary: {
        query: "Extract product details as structured JSON",
        schema: SEARCH_PRODUCT_SCHEMA,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Exa search timeout")), EXA_SEARCH_TIMEOUT_MS),
    ),
  ]);

  const rawResults = searchResult.results ?? [];
  console.log(`  [exa-search] Got ${rawResults.length} raw results`);

  const validated: ExaSearchResult[] = [];

  for (const result of rawResults) {
    if (!result.summary || !result.url) continue;

    let parsed: {
      name?: string;
      price?: string;
      original_price?: string;
      currency?: string;
      brand?: string;
      image_url?: string;
      options?: string;
    };

    try {
      parsed = JSON.parse(result.summary);
    } catch {
      continue;
    }

    if (!parsed.name || !parsed.price || !isValidPrice(parsed.price)) continue;

    const options = mapOptions(
      parseOptionsString(parsed.options).map((o) => ({
        name: o.name,
        values: o.values,
      })),
    );

    validated.push({
      name: parsed.name,
      url: result.url,
      price: stripCurrencySymbol(parsed.price),
      original_price: cleanExtractField(parsed.original_price)
        ? stripCurrencySymbol(parsed.original_price!)
        : undefined,
      currency: cleanExtractField(parsed.currency),
      brand: cleanExtractField(parsed.brand),
      image_url: cleanExtractField(parsed.image_url),
      options,
      relevance_score: result.score ?? 0,
    });
  }

  console.log(`  [exa-search] ${validated.length} results passed validation`);

  // Filter out non-product pages (editorial, review sites, staging environments)
  const retailOnly = validated.filter((result) => {
    const ok = isProductPage(result.url);
    if (!ok) {
      console.log(`  [exa-search] Dropping non-product URL: ${result.url}`);
    }
    return ok;
  });
  console.log(`  [exa-search] ${retailOnly.length} results after retail filter`);

  // Filter out 404s and dead domains in parallel
  const reachability = await Promise.all(
    retailOnly.map(async (result) => {
      const ok = await isUrlReachable(result.url);
      if (!ok) {
        console.log(`  [exa-search] Dropping unreachable URL: ${result.url}`);
      }
      return { result, ok };
    }),
  );

  const reachable = reachability.filter(({ ok }) => ok).map(({ result }) => result);
  console.log(`  [exa-search] ${reachable.length} results after URL check`);
  return reachable;
}
