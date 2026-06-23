import type { FirecrawlConfig } from "./types.js";

/**
 * Discovery config. There is no real Firecrawl server anymore — the "firecrawl"
 * provider does a static fetch and the "browserbase" provider renders locally.
 * We always return a non-null config so the discovery pipeline proceeds; the
 * fields are vestigial (the crawl path degrades to null when unreachable).
 */
export function getFirecrawlConfig(): FirecrawlConfig | null {
  return { baseUrl: "http://localhost:0", apiKey: "local" };
}
