import type { FirecrawlConfig } from "./types.js";

export function getFirecrawlConfig(): FirecrawlConfig | null {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  const baseUrl =
    process.env.FIRECRAWL_BASE_URL || "http://localhost:3002";
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}
