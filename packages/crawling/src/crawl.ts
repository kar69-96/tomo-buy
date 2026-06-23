import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
  CRAWL_PAGE_LIMIT,
} from "./constants.js";
import { pollFirecrawlJob } from "./poll.js";

export async function firecrawlCrawlAsync(
  url: string,
  config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlExtract[] | null> {
  try {
    const response = await fetch(`${config.baseUrl}/v1/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        url,
        maxDepth: 1,
        limit: CRAWL_PAGE_LIMIT,
        scrapeOptions: {
          formats: ["json"],
          jsonOptions: {
            schema: FIRECRAWL_EXTRACT_SCHEMA,
            prompt: FIRECRAWL_EXTRACT_PROMPT,
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, unknown>;
    const jobId = (body["id"] ?? body["jobId"]) as string | undefined;
    if (!jobId) return null;

    const result = await pollFirecrawlJob(
      `${config.baseUrl}/v1/crawl/${jobId}`,
      config.apiKey,
      timeoutMs,
    );
    if (!result) return null;

    // Crawl results: array of { data: { extract: {...} } } or flat array
    const data = result["data"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(data)) return null;

    return data.map((page) => {
      const extract =
        (page["json"] as FirecrawlExtract | undefined) ??
        (page["extract"] as FirecrawlExtract | undefined) ??
        (page as unknown as FirecrawlExtract);
      return extract;
    });
  } catch {
    return null;
  }
}
