import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import {
  ProductNotFoundError,
  classifyContent,
} from "./constants.js";
import { extractProductFromHtml } from "./html-extract.js";

export type FirecrawlFailureCode =
  | "blocked"
  | "not_found"
  | "extract_empty"
  | "http_error"
  | "transport_error";

export interface FirecrawlFailure {
  code: FirecrawlFailureCode;
  detail?: string;
}

export interface FirecrawlScrapeResult {
  extract: FirecrawlExtract | null;
  failure: FirecrawlFailure | null;
}

let lastFirecrawlFailure: FirecrawlFailure | null = null;

/**
 * Static, no-browser product extraction: plain fetch the URL's HTML and run the
 * pure extractors (JSON-LD / meta / microdata). The cheapest discovery tier —
 * works for server-rendered and Shopify-style pages without any external service.
 * (Kept the name `firecrawlScrapeJson` so the discovery pipeline is unchanged.)
 */
async function firecrawlScrapeJson(
  url: string,
  _config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlScrapeResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 15000)),
    });
  } catch (err) {
    const failure: FirecrawlFailure = {
      code: "transport_error",
      detail: err instanceof Error ? err.message : String(err),
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  if (response.status === 404 || response.status === 410) {
    const failure: FirecrawlFailure = { code: "not_found", detail: `status ${response.status}` };
    lastFirecrawlFailure = failure;
    throw new ProductNotFoundError(`Page returned HTTP ${response.status}`);
  }
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    const failure: FirecrawlFailure = { code: "blocked", detail: `status ${response.status}` };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }
  if (!response.ok) {
    const failure: FirecrawlFailure = { code: "http_error", detail: `status ${response.status}` };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  let html: string;
  try {
    html = await response.text();
  } catch (err) {
    const failure: FirecrawlFailure = {
      code: "transport_error",
      detail: err instanceof Error ? err.message : String(err),
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  // Bot-block / not-found classification on the raw HTML
  const classification = classifyContent(html, 20000);
  if (classification === "blocked") {
    const failure: FirecrawlFailure = { code: "blocked", detail: "blocked pattern detected" };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }
  if (classification === "not_found") {
    const failure: FirecrawlFailure = { code: "not_found", detail: "not_found pattern detected" };
    lastFirecrawlFailure = failure;
    throw new ProductNotFoundError("Page content indicates product not found");
  }

  const extract = extractProductFromHtml(html);
  if (!extract || (!extract.name && !extract.price)) {
    const failure: FirecrawlFailure = {
      code: "extract_empty",
      detail: "no structured product data in static HTML",
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  lastFirecrawlFailure = null;
  return { extract, failure: null };
}

export { firecrawlScrapeJson };

export async function firecrawlExtractAsync(
  urls: string[],
  config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlExtract[] | null> {
  try {
    const results: FirecrawlExtract[] = [];
    for (const url of urls) {
      const { extract } = await firecrawlScrapeJson(url, config, timeoutMs);
      if (extract) results.push(extract);
    }
    return results.length > 0 ? results : null;
  } catch (err) {
    if (err instanceof ProductNotFoundError) throw err;
    const failure: FirecrawlFailure = {
      code: "transport_error",
      detail: err instanceof Error ? err.message : String(err),
    };
    lastFirecrawlFailure = failure;
    return null;
  }
}
