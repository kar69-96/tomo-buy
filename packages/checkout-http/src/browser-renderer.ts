/**
 * Thin Browserbase wrapper — read-only page rendering.
 *
 * Delegates to the Browserbase adapter microservice on port 3003.
 * The adapter handles session lifecycle, challenge resolution, and
 * content readiness. This module just sends a POST /scrape request
 * and parses the response.
 *
 * Used when SPA scorer says the page needs JS rendering.
 * Read-only — no form filling, no navigation beyond initial load.
 */

import { parseSetCookieHeader } from "./session-manager.js";

// ---- Config ----

const ADAPTER_BASE_URL =
  process.env.BROWSERBASE_ADAPTER_URL ?? "http://localhost:3003";

const RENDER_TIMEOUT_MS = 45_000;

// ---- Types ----

export interface RenderedPage {
  readonly html: string;
  readonly cookies: readonly {
    name: string;
    value: string;
    domain: string;
    path: string;
  }[];
  readonly finalUrl: string;
}

interface AdapterResponse {
  readonly content: string;
  readonly pageStatusCode: number;
  readonly pageError?: string;
  readonly contentType?: string;
  readonly finalUrl?: string;
}

// ---- Main renderer ----

/**
 * Render a URL via the Browserbase adapter (port 3003).
 *
 * Sends a POST /scrape request, which creates a Browserbase session,
 * navigates to the URL, waits for content readiness, and returns
 * the fully rendered HTML.
 *
 * @param url - The URL to render
 * @returns RenderedPage with HTML, cookies, and final URL
 * @throws Error if the adapter is unreachable or returns an error
 */
export async function renderPage(url: string): Promise<RenderedPage> {
  const response = await fetch(`${ADAPTER_BASE_URL}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      timeout: RENDER_TIMEOUT_MS,
    }),
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS + 5_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Browserbase adapter error (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as AdapterResponse;

  if (data.pageError) {
    throw new Error(`Browserbase page error: ${data.pageError}`);
  }

  // Parse cookies from Set-Cookie headers in the adapter response
  // The adapter doesn't return cookies directly, but the HTML may
  // contain cookie-setting script tags. We return an empty array
  // here — the caller gets cookies from HTTP responses instead.
  const finalUrl = data.finalUrl ?? url;
  const hostname = extractHostname(finalUrl);

  // Extract cookies from meta http-equiv="Set-Cookie" if present
  const cookies: { name: string; value: string; domain: string; path: string }[] = [];
  const setCookiePattern = /<meta\s+http-equiv="Set-Cookie"\s+content="([^"]+)"/gi;
  let match;
  while ((match = setCookiePattern.exec(data.content)) !== null) {
    const parsed = parseSetCookieHeader(match[1]!, finalUrl);
    if (parsed) {
      cookies.push({
        name: parsed.name,
        value: parsed.value,
        domain: parsed.domain,
        path: parsed.path,
      });
    }
  }

  return {
    html: data.content,
    cookies,
    finalUrl,
  };
}

// ---- Helpers ----

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
