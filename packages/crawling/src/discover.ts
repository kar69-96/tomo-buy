import type { ProductOption } from "@bloon/core";
import { getFirecrawlConfig } from "./client.js";
import { stripCurrencySymbol, mapOptions, isValidPrice, cleanExtractField, extractSlugWords, computeUrlProductOverlap } from "./helpers.js";
import { chooseBestCandidate, type CandidateInput } from "./parser-ensemble.js";
import { defaultQueryDiscoveryProviders, type ExaExtractResult } from "./providers.js";
import {
  resolveVariantPricesViaFirecrawl,
  resolveVariantPricesViaCrawl,
} from "./variant.js";
import { fetchShopifyOptions, fetchShopifyProduct } from "./shopify.js";
import { ProductBlockedError, ProductNotFoundError } from "./constants.js";
import { discoverViaExa } from "./exa-extract.js";
import type { FirecrawlExtract } from "./types.js";
import type { DiscoveryStrategy } from "./url-classifier.js";

const VALID_DISCOVERY_FAILURE_CODES = new Set<string>([
  "llm_config", "blocked", "not_found", "adapter_502",
  "render_timeout", "http_error", "extract_empty", "transport_error",
  "exa_error",
]);

function toDiscoveryFailureCode(code: string): DiscoveryFailureCode {
  return VALID_DISCOVERY_FAILURE_CODES.has(code)
    ? (code as DiscoveryFailureCode)
    : "transport_error";
}

export interface FullDiscoveryResult {
  name: string;
  price: string;
  image_url?: string;
  method: string;
  options: ProductOption[];
  original_price?: string;
  currency?: string;
  description?: string;
  brand?: string;
  error?: string;
  // Optional diagnostics fields for internal test/benchmark harnesses.
  failure_code?: DiscoveryFailureCode;
  failure_stage?: string;
  failure_detail?: string;
}

export type DiscoveryFailureCode =
  | "llm_config"
  | "blocked"
  | "render_timeout"
  | "adapter_502"
  | "extract_empty"
  | "not_found"
  | "http_error"
  | "transport_error"
  | "exa_error";

export interface DiscoveryDiagnostics {
  failureCode?: DiscoveryFailureCode;
  failureStage?: string;
  failureDetail?: string;
  method?: "firecrawl" | "browserbase" | "exa";
  timings?: {
    totalMs: number;
    firecrawlMs: number;
    firecrawlAttempts: number;
    browserbaseMs: number;
    exaMs: number;
    variantMs: number;
  };
}

// ---- Tier 2: Firecrawl 3-step discovery pipeline ----

export async function discoverViaFirecrawl(
  url: string,
): Promise<FullDiscoveryResult | null> {
  const { result } = await discoverViaFirecrawlWithDiagnostics(url);
  return result;
}

export async function discoverViaFirecrawlWithDiagnostics(
  url: string,
): Promise<{ result: FullDiscoveryResult | null; diagnostics: DiscoveryDiagnostics }> {
  const totalStart = Date.now();
  const config = getFirecrawlConfig();
  if (!config) {
    return {
      result: null,
      diagnostics: {
        failureCode: "llm_config",
        failureStage: "config",
        failureDetail: "missing FIRECRAWL_API_KEY configuration",
        timings: {
          totalMs: Date.now() - totalStart,
          firecrawlMs: 0,
          firecrawlAttempts: 0,
          browserbaseMs: 0,
          exaMs: 0,
          variantMs: 0,
        },
      },
    };
  }
  const minConfidence = Number.parseFloat(
    process.env.QUERY_MIN_CONFIDENCE ?? "0.75",
  );
  const perAttemptTimeoutMs = Number.parseInt(
    process.env.QUERY_FIRECRAWL_TIMEOUT_MS ?? "90000",
    10,
  );
  const diagnostics: DiscoveryDiagnostics = {};
  let firecrawlMs = 0;
  let firecrawlAttempts = 0;
  let browserbaseMs = 0;
  let exaMs = 0;
  let variantMs = 0;
  const failurePriority: Record<DiscoveryFailureCode, number> = {
    llm_config: 100,
    blocked: 90,
    not_found: 85,
    adapter_502: 70,
    render_timeout: 65,
    http_error: 60,
    exa_error: 50,
    extract_empty: 40,
    transport_error: 30,
  };
  const setFailure = (
    code: DiscoveryFailureCode,
    stage: string,
    detail?: string,
  ): void => {
    const current = diagnostics.failureCode;
    if (!current || failurePriority[code] >= failurePriority[current]) {
      diagnostics.failureCode = code;
      diagnostics.failureStage = stage;
      diagnostics.failureDetail = detail;
    }
  };

  try {
    // Shopify fast-path: try native JSON endpoint for Shopify product URLs
    if (url.includes("/products/")) {
      const shopifyStart = Date.now();
      const shopifyExtract = await fetchShopifyProduct(url);
      firecrawlMs += Date.now() - shopifyStart;
      if (shopifyExtract?.name && isValidPrice(shopifyExtract.price ?? "")) {
        const options = mapOptions(shopifyExtract.options);
        return {
          result: {
            name: shopifyExtract.name,
            price: stripCurrencySymbol(shopifyExtract.price!),
            image_url: cleanExtractField(shopifyExtract.image_url),
            method: "shopify",
            options,
            currency: cleanExtractField(shopifyExtract.currency),
            description: cleanExtractField(shopifyExtract.description),
            brand: cleanExtractField(shopifyExtract.brand),
          },
          diagnostics: {
            method: "firecrawl",
            timings: {
              totalMs: Date.now() - totalStart,
              firecrawlMs,
              firecrawlAttempts: 0,
              browserbaseMs: 0,
              exaMs: 0,
              variantMs: 0,
            },
          },
        };
      }
    }

    // Fire Exa in parallel with Firecrawl (non-blocking, ~5-15s)
    const exaStart = Date.now();
    const exaPromise: Promise<ExaExtractResult> = defaultQueryDiscoveryProviders
      .exaExtract(url)
      .then((r) => { exaMs = Date.now() - exaStart; return r; })
      .catch(() => { exaMs = Date.now() - exaStart; return { extract: null } as ExaExtractResult; });

    // Step 1: collect candidates from Firecrawl attempts
    const candidates: CandidateInput[] = [];
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      }
      const attemptStart = Date.now();
      try {
        const { extract, failure: firecrawlFailure } = await defaultQueryDiscoveryProviders.firecrawlExtract(
          url,
          config,
          perAttemptTimeoutMs,
        );
        firecrawlMs += Date.now() - attemptStart;
        firecrawlAttempts += 1;
        if (!extract && firecrawlFailure) {
          setFailure(
            toDiscoveryFailureCode(firecrawlFailure.code),
            "firecrawl_extract",
            firecrawlFailure.detail,
          );
        }
        if (extract) {
          candidates.push({ source: "firecrawl", extract });
          const bestSoFar = chooseBestCandidate(candidates);
          if (
            bestSoFar
            && bestSoFar.confidence >= minConfidence
            && isValidPrice(bestSoFar.extract.price ?? "")
          ) {
            break;
          }
          if (
            bestSoFar?.extract.price
            && !isValidPrice(bestSoFar.extract.price)
          ) {
            // Price is explicitly invalid; additional retries rarely improve signal.
            break;
          }
        }
      } catch (attemptErr) {
        firecrawlMs += Date.now() - attemptStart;
        firecrawlAttempts += 1;
        if (attemptErr instanceof ProductNotFoundError) throw attemptErr;
        if (attemptErr instanceof ProductBlockedError) {
          setFailure("blocked", "firecrawl_extract", attemptErr.message);
          break; // Blocked content; proceed to Browserbase repair
        }
        // Timeout or other transport error
        setFailure(
          "transport_error",
          "firecrawl_extract",
          attemptErr instanceof Error ? attemptErr.message : String(attemptErr),
        );
      }
    }

    // Await Exa result (launched in parallel with Firecrawl)
    const exaResult = await exaPromise;
    if (exaResult.extract) {
      candidates.push({ source: "exa", extract: exaResult.extract });
    } else if (exaResult.error) {
      setFailure("exa_error", "exa_extract", exaResult.error);
    }

    let best = chooseBestCandidate(candidates);
    const hasValidPrice = Boolean(best?.extract.price && isValidPrice(best.extract.price));

    // Try Browserbase + Gemini as a repair path when:
    // - No valid price exists (regardless of whether name/price fields are present), OR
    // - Confidence is too low on a candidate
    if (!hasValidPrice || (best && best.confidence < minConfidence)) {
      const browserbaseStart = Date.now();
      try {
        const { extract: bbExtract, failure: bbFailure } = await defaultQueryDiscoveryProviders.browserbaseExtract(
          url,
          perAttemptTimeoutMs,
        );
        browserbaseMs += Date.now() - browserbaseStart;
        if (!bbExtract && bbFailure) {
          setFailure(
            toDiscoveryFailureCode(bbFailure.code),
            "browserbase_extract",
            bbFailure.detail,
          );
        }
        if (bbExtract) {
          candidates.push({ source: "browserbase", extract: bbExtract });
          best = chooseBestCandidate(candidates);
        }
      } catch (bbErr) {
        browserbaseMs += Date.now() - browserbaseStart;
        if (bbErr instanceof ProductNotFoundError) throw bbErr;
        setFailure(
          bbErr instanceof ProductBlockedError ? "blocked" : "transport_error",
          "browserbase_extract",
          bbErr instanceof Error ? bbErr.message : String(bbErr),
        );
      }
    }

    if (!best || !best.extract.price || !isValidPrice(best.extract.price)) {
      return {
        result: null,
        diagnostics: {
          failureCode: diagnostics.failureCode ?? "extract_empty",
          failureStage: diagnostics.failureStage ?? "ranking",
          failureDetail: diagnostics.failureDetail ?? "no valid price-bearing candidate",
          timings: {
            totalMs: Date.now() - totalStart,
            firecrawlMs,
            firecrawlAttempts,
            browserbaseMs,
            exaMs,
            variantMs,
          },
        },
      };
    }
    const extract = best.extract;

    // URL-product name validation: reject if extracted name has zero overlap with URL slug
    const slugWords = extractSlugWords(url);
    if (slugWords.length >= 2 && extract.name) {
      const urlOverlap = computeUrlProductOverlap(url, extract.name);
      if (urlOverlap === 0) {
        return {
          result: null,
          diagnostics: {
            failureCode: "extract_empty",
            failureStage: "url_validation",
            failureDetail: `extracted "${extract.name}" does not match URL slug`,
            timings: {
              totalMs: Date.now() - totalStart,
              firecrawlMs,
              firecrawlAttempts,
              browserbaseMs,
              exaMs,
              variantMs,
            },
          },
        };
      }
    }

    let options = mapOptions(extract.options);

    // Shopify fallback: if no options from LLM, try the Shopify .json endpoint
    if (options.length === 0) {
      const shopifyOpts = await fetchShopifyOptions(url);
      if (shopifyOpts) options = shopifyOpts;
    }

    // Step 2 or 3 — only if options exist
    if (options.length > 0) {
      const variantStart = Date.now();
      const hasVariantUrls =
        extract.variant_urls && extract.variant_urls.length > 0;
      if (hasVariantUrls) {
        // Step 2: /extract on variant URLs with bounded adaptive budget
        options = await resolveVariantPricesViaFirecrawl(
          extract.variant_urls!,
          url,
          config,
          options,
          {
            maxVariantUrls: Number.parseInt(
              process.env.QUERY_MAX_VARIANT_URLS ?? "12",
              10,
            ),
          },
        );
      } else {
        // Step 3: /crawl from product URL
        options = await resolveVariantPricesViaCrawl(
          url,
          config,
          options,
          extract.name!,
        );
      }
      variantMs += Date.now() - variantStart;
    }

    return {
      result: {
      name: extract.name!,
      price: stripCurrencySymbol(extract.price!),
      image_url: cleanExtractField(extract.image_url),
      method: best.source === "browserbase" ? "browserbase" : best.source === "exa" ? "exa" : "firecrawl",
      options,
      original_price: cleanExtractField(extract.original_price)
        ? stripCurrencySymbol(extract.original_price!)
        : undefined,
      currency: cleanExtractField(extract.currency),
      description: cleanExtractField(extract.description),
      brand: cleanExtractField(extract.brand),
      },
      diagnostics: {
        method: best.source === "browserbase" ? "browserbase" : best.source === "exa" ? "exa" : "firecrawl",
        timings: {
          totalMs: Date.now() - totalStart,
          firecrawlMs,
          firecrawlAttempts,
          browserbaseMs,
          exaMs,
          variantMs,
        },
      },
    };
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return {
        result: {
          name: "",
          price: "",
          method: "firecrawl",
          options: [],
          error: "product_not_found",
          failure_code: "not_found",
          failure_stage: diagnostics.failureStage ?? "classification",
          failure_detail: err.message,
        },
        diagnostics: {
          failureCode: "not_found",
          failureStage: diagnostics.failureStage ?? "classification",
          failureDetail: err.message,
          timings: {
            totalMs: Date.now() - totalStart,
            firecrawlMs,
            firecrawlAttempts,
            browserbaseMs,
            exaMs,
            variantMs,
          },
        },
      };
    }
    return {
      result: null,
      diagnostics: {
        failureCode: diagnostics.failureCode ?? "transport_error",
        failureStage: diagnostics.failureStage ?? "unknown",
        failureDetail:
          diagnostics.failureDetail
          ?? (err instanceof Error ? err.message : String(err)),
        timings: {
          totalMs: Date.now() - totalStart,
          firecrawlMs,
          firecrawlAttempts,
          browserbaseMs,
          exaMs,
          variantMs,
        },
      },
    };
  }
}

// ---- URL-slug overlap validation helper ----

/** Returns true if the extracted name has acceptable overlap with the URL slug words. */
function passesUrlOverlap(url: string, name: string | undefined): boolean {
  if (!name) return true; // no name to validate against
  const slugWords = extractSlugWords(url);
  if (slugWords.length < 2) return true; // slug too short to validate
  return computeUrlProductOverlap(url, name) > 0;
}

// ---- Strategy-aware discovery ----

/** Convert a FirecrawlExtract to FullDiscoveryResult with the given method label. */
function extractToResult(extract: FirecrawlExtract, method: string): FullDiscoveryResult {
  const options = mapOptions(extract.options);
  return {
    name: extract.name!,
    price: stripCurrencySymbol(extract.price!),
    image_url: cleanExtractField(extract.image_url),
    method,
    options,
    original_price: cleanExtractField(extract.original_price)
      ? stripCurrencySymbol(extract.original_price!)
      : undefined,
    currency: cleanExtractField(extract.currency),
    description: cleanExtractField(extract.description),
    brand: cleanExtractField(extract.brand),
  };
}

/**
 * Strategy-aware discovery dispatch.
 *
 * | Strategy    | Execution path                                      | Expected time |
 * |-------------|-----------------------------------------------------|---------------|
 * | shopify     | fetchShopifyProduct() → if null, exa_first          | ~1s happy path |
 * | exa_first   | discoverViaExa() → 1 Firecrawl attempt → Browserbase | ~15s (Exa win) |
 * | blocked_only| Browserbase directly (skip Exa + Firecrawl)         | ~30-60s        |
 *
 * Unlike discoverViaFirecrawl() which retries Firecrawl 3 times, exa_first runs only
 * 1 Firecrawl attempt (Exa already tried first).
 */
export async function discoverWithStrategy(
  url: string,
  strategy: DiscoveryStrategy,
): Promise<FullDiscoveryResult | null> {
  const timeoutMs = Number.parseInt(
    process.env.QUERY_FIRECRAWL_TIMEOUT_MS ?? "90000",
    10,
  );

  // ---- Shopify: native JSON endpoint ----
  if (strategy === "shopify") {
    try {
      const shopifyExtract = await fetchShopifyProduct(url);
      if (shopifyExtract?.name && isValidPrice(shopifyExtract.price ?? "")) {
        return extractToResult(shopifyExtract, "shopify");
      }
    } catch {
      // Shopify JSON failed, fall through to exa_first
    }
    // Fall through to exa_first
  }

  // ---- blocked_only: skip Exa and Firecrawl, go directly to Browserbase ----
  if (strategy === "blocked_only") {
    const { extract } = await defaultQueryDiscoveryProviders
      .browserbaseExtract(url, timeoutMs)
      .catch(() => ({ extract: null, failure: null }));
    if (!extract?.price || !isValidPrice(extract.price) || !passesUrlOverlap(url, extract.name)) return null;
    return extractToResult(extract, "browserbase");
  }

  // ---- exa_first (also the fallback from shopify) ----

  // 1. Exa: full extraction with variant prices
  const exaResult = await discoverViaExa(url).catch(() => null);
  if (exaResult?.price && isValidPrice(exaResult.price) && passesUrlOverlap(url, exaResult.name)) {
    return exaResult;
  }

  // 2. Two Firecrawl attempts (retry once on failure)
  const config = getFirecrawlConfig();
  if (config) {
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      const { extract: fcExtract } = await defaultQueryDiscoveryProviders
        .firecrawlExtract(url, config, timeoutMs)
        .catch(() => ({ extract: null, failure: null }));
      if (fcExtract?.price && isValidPrice(fcExtract.price) && passesUrlOverlap(url, fcExtract.name)) {
        let options = mapOptions(fcExtract.options);
        if (options.length === 0) {
          const shopifyOpts = await fetchShopifyOptions(url);
          if (shopifyOpts) options = shopifyOpts;
        }
        return {
          name: fcExtract.name!,
          price: stripCurrencySymbol(fcExtract.price!),
          image_url: cleanExtractField(fcExtract.image_url),
          method: "firecrawl",
          options,
          original_price: cleanExtractField(fcExtract.original_price)
            ? stripCurrencySymbol(fcExtract.original_price!)
            : undefined,
          currency: cleanExtractField(fcExtract.currency),
          description: cleanExtractField(fcExtract.description),
          brand: cleanExtractField(fcExtract.brand),
        };
      }
    }
  }

  // 3. Browserbase fallback
  const { extract: bbExtract } = await defaultQueryDiscoveryProviders
    .browserbaseExtract(url, timeoutMs)
    .catch(() => ({ extract: null, failure: null }));
  if (!bbExtract?.price || !isValidPrice(bbExtract.price) || !passesUrlOverlap(url, bbExtract.name)) return null;
  return extractToResult(bbExtract, "browserbase");
}
