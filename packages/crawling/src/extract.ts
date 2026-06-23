import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
  BLOCKED_PATTERNS,
  NOT_FOUND_PATTERNS,
  ProductNotFoundError,
  classifyContent,
} from "./constants.js";

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

async function firecrawlScrapeJson(
  url: string,
  config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlScrapeResult> {
  const response = await fetch(`${config.baseUrl}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["json", "markdown"],
      jsonOptions: {
        schema: FIRECRAWL_EXTRACT_SCHEMA,
        prompt: FIRECRAWL_EXTRACT_PROMPT,
      },
      timeout: Math.min(timeoutMs, 90000),
      waitFor: 0, // Adapter handles all waiting (smart 3-phase wait)
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const failure: FirecrawlFailure = {
      code: "http_error",
      detail: `firecrawl response ${response.status}`,
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  const body = (await response.json()) as Record<string, unknown>;
  if (!body["success"]) {
    const failure: FirecrawlFailure = {
      code: "http_error",
      detail: "firecrawl body success=false",
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  const data = body["data"] as Record<string, unknown> | undefined;
  if (!data) {
    const failure: FirecrawlFailure = {
      code: "extract_empty",
      detail: "firecrawl body missing data",
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  // Reject non-2xx pages (403 Cloudflare, 404 not found)
  const metadata = data["metadata"] as Record<string, unknown> | undefined;
  const statusCode = metadata?.["statusCode"] as number | undefined;
  if (statusCode === 404 || statusCode === 410) {
    const failure: FirecrawlFailure = {
      code: "not_found",
      detail: `firecrawl status ${statusCode}`,
    };
    lastFirecrawlFailure = failure;
    throw new ProductNotFoundError(`Page returned HTTP ${statusCode}`);
  }
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    const failure: FirecrawlFailure = {
      code: "blocked",
      detail: `firecrawl status ${statusCode}`,
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }
  if (statusCode && statusCode >= 400) {
    const failure: FirecrawlFailure = {
      code: "http_error",
      detail: `firecrawl status ${statusCode}`,
    };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  // Reject empty/tiny content (page didn't render)
  const markdown = ((data["markdown"] as string) ?? "").trim();

  // Classify challenge and not-found signals first, even for very short pages.
  const shortClassification = classifyContent(markdown, Infinity);
  if (shortClassification === "blocked") {
    const failure: FirecrawlFailure = { code: "blocked", detail: "blocked pattern detected in markdown" };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }
  if (shortClassification === "not_found") {
    const failure: FirecrawlFailure = { code: "not_found", detail: "not_found pattern detected in markdown" };
    lastFirecrawlFailure = failure;
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }
  if (markdown.length < 50) {
    const failure: FirecrawlFailure = { code: "extract_empty", detail: `markdown too short (${markdown.length})` };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }

  // For longer pages, only check patterns below certain thresholds
  const lenClassification = classifyContent(markdown, 5000);
  if (lenClassification === "blocked") {
    const failure: FirecrawlFailure = { code: "blocked", detail: "blocked pattern detected in markdown" };
    lastFirecrawlFailure = failure;
    return { extract: null, failure };
  }
  if (lenClassification === "not_found") {
    const failure: FirecrawlFailure = { code: "not_found", detail: "not_found pattern detected in markdown" };
    lastFirecrawlFailure = failure;
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }

  const extract = ((data["json"] ?? data["extract"] ?? null) as FirecrawlExtract | null);
  if (!extract || (!extract.name && !extract.price)) {
    const failure: FirecrawlFailure = {
      code: "extract_empty",
      detail: "firecrawl response missing usable json extract",
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
