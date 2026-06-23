import { firecrawlScrapeJson, type FirecrawlFailure } from "./extract.js";
import { browserbaseExtractWithFailure } from "./browserbase-extract.js";
import type { BrowserbaseExtractResult } from "./browserbase-extract.js";
import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import { discoverViaExa } from "./exa-extract.js";

export interface FirecrawlExtractResult {
  extract: FirecrawlExtract | null;
  failure: FirecrawlFailure | null;
}

export interface ExaExtractResult {
  extract: FirecrawlExtract | null;
  error?: string;
}

export interface QueryDiscoveryProviders {
  firecrawlExtract: (
    url: string,
    config: FirecrawlConfig,
    timeoutMs: number,
  ) => Promise<FirecrawlExtractResult>;
  browserbaseExtract: (url: string, timeoutMs: number) => Promise<BrowserbaseExtractResult>;
  exaExtract: (url: string) => Promise<ExaExtractResult>;
}

export const defaultQueryDiscoveryProviders: QueryDiscoveryProviders = {
  async firecrawlExtract(url, config, timeoutMs) {
    return firecrawlScrapeJson(url, config, timeoutMs);
  },
  async browserbaseExtract(url, timeoutMs) {
    return browserbaseExtractWithFailure(url, timeoutMs);
  },
  async exaExtract(url) {
    try {
      const result = await discoverViaExa(url);
      if (!result || !result.name || !result.price) return { extract: null };
      return {
        extract: {
          name: result.name,
          price: result.price,
          image_url: result.image_url,
          currency: result.currency,
          description: result.description,
          brand: result.brand,
          original_price: result.original_price,
          options: result.options,
        },
      };
    } catch (err) {
      return {
        extract: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
