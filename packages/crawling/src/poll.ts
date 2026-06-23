import { FIRECRAWL_POLL_INTERVAL_MS } from "./constants.js";

export async function pollFirecrawlJob(
  jobUrl: string,
  apiKey: string,
  timeoutMs: number,
  intervalMs: number = FIRECRAWL_POLL_INTERVAL_MS,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(jobUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as Record<string, unknown>;
      const status = body["status"] as string | undefined;

      if (status === "completed") return body;
      if (status === "failed") return null;

      // Still processing — wait before next poll
      await new Promise((r) => setTimeout(r, intervalMs));
    } catch {
      return null;
    }
  }

  return null; // Timeout
}
