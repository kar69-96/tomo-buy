/**
 * URL-based routing classifier derived from Phase 2 bulk test data (46/61 pass, 2026-03-08).
 *
 * Routing rules:
 *   shopify      → 8/8 wins via native Shopify JSON (~1s, free, no LLM)
 *   blocked_only → confirmed 403/429/WAF-blocked: skip Firecrawl+Exa, go straight to Browserbase
 *   exa_first    → everything else: Exa won 37/46 non-Shopify successes
 */

export type DiscoveryStrategy = "shopify" | "exa_first" | "blocked_only";

/**
 * Domains confirmed to block both Firecrawl and Exa (403/429/WAF).
 * Matched against full hostname and all subdomains.
 */
const BLOCKED_DOMAINS = new Set<string>([
  "chewy.com",
  "barnesandnoble.com",
  "etsy.com",
  // Amazon: Exa works (correct name + price), Firecrawl blocked.
  // Routed to exa_first — Exa succeeds, Firecrawl retries are capped at 2,
  // Browserbase fallback still available if Exa fails.
  // Big-box retailers
  "bestbuy.com",
  "target.com",
  "walmart.com",
  "costco.com",
  "levi.com",
]);

/**
 * Returns the discovery strategy for a product URL based on Phase 2 bulk test evidence.
 *
 * - 'shopify'     : URL has /products/ path or *.myshopify.com hostname
 * - 'blocked_only': hostname is in the confirmed-blocked list
 * - 'exa_first'   : everything else (default)
 */
export function classifyUrl(url: string): DiscoveryStrategy {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "exa_first";
  }

  // Shopify fast-path: native /products.json endpoint
  if (url.includes("/products/") || hostname.endsWith(".myshopify.com")) {
    return "shopify";
  }

  // Bot-blocked domains: skip Firecrawl + Exa, go straight to Browserbase
  for (const blocked of BLOCKED_DOMAINS) {
    if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
      return "blocked_only";
    }
  }

  return "exa_first";
}
