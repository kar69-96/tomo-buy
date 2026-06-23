// ---- Firecrawl discovery pipeline ----
export { discoverViaFirecrawl, discoverWithStrategy } from "./discover.js";
export type { FullDiscoveryResult } from "./discover.js";

// ---- Client config ----
export { getFirecrawlConfig } from "./client.js";

// ---- Types ----
export type { FirecrawlExtract, FirecrawlConfig } from "./types.js";
export {
  chooseBestCandidate,
  rankCandidate,
  type CandidateInput,
  type RankedCandidate,
} from "./parser-ensemble.js";
export {
  defaultQueryDiscoveryProviders,
  type QueryDiscoveryProviders,
  type ExaExtractResult,
} from "./providers.js";

// ---- Exa.ai ----
export { getExaClient } from "./exa-client.js";
export { discoverViaExa, enrichVariantPricesViaExa } from "./exa-extract.js";
export { searchProducts, isProductPage, isUrlReachable, type ExaSearchResult, type SearchProductsOptions } from "./exa-search.js";

// ---- URL classifier ----
export { classifyUrl, type DiscoveryStrategy } from "./url-classifier.js";

// ---- NL search parser ----
export { parseSearchQuery, type ParsedSearchQuery } from "./nl-search.js";

// ---- Variant helpers ----
export { valuesLikelyMatch, normalizeToken } from "./variant.js";

// ---- Browserbase fallback extraction ----
export { browserbaseExtract, browserbaseExtractWithFailure } from "./browserbase-extract.js";
export type { BrowserbaseFailure, BrowserbaseExtractResult } from "./browserbase-extract.js";

// ---- Constants ----
export {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
  BLOCKED_PATTERNS,
  NOT_FOUND_PATTERNS,
  ProductNotFoundError,
  MAX_VARIANT_EXTRACT,
  CRAWL_PAGE_LIMIT,
  VARIANT_EXTRACT_CONCURRENCY,
  FIRECRAWL_POLL_INTERVAL_MS,
  classifyContent,
} from "./constants.js";

// ---- Shopify ----
export { fetchShopifyOptions, fetchShopifyProduct } from "./shopify.js";

// ---- Helpers (also used by checkout for scrape code) ----
export {
  stripCurrencySymbol,
  extractPriceFromString,
  mapOptions,
  computeWordOverlap,
  isValidPrice,
  cleanExtractField,
  isRedirectToOtherPage,
  extractSlugWords,
  computeUrlProductOverlap,
} from "./helpers.js";

// ---- Lower-level functions ----
export { pollFirecrawlJob } from "./poll.js";
export { firecrawlExtractAsync, firecrawlScrapeJson } from "./extract.js";
export type { FirecrawlFailure, FirecrawlScrapeResult } from "./extract.js";
export { firecrawlCrawlAsync } from "./crawl.js";
export {
  resolveVariantPricesViaFirecrawl,
  resolveVariantPricesViaCrawl,
} from "./variant.js";
