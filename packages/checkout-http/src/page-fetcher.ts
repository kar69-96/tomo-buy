/**
 * HTTP page fetcher with manual redirect following.
 *
 * Uses redirect: "manual" so the engine can inspect each redirect
 * (for staleness detection: cached redirect chain vs. actual).
 * Max 5 redirects per fetch (configurable).
 */

import { MAX_REDIRECTS_PER_STEP } from "@bloon/core";
import type { SessionState, FetchResult, RedirectEntry } from "./types.js";
import {
  buildRequestHeaders,
  addCookiesFromHeaders,
} from "./session-manager.js";

// ---- Fetch a page with manual redirect following ----

export interface FetchOptions {
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: string;
  readonly contentType?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface FetchPageResult {
  readonly fetchResult: FetchResult;
  readonly updatedSession: SessionState;
}

export async function fetchPage(
  url: string,
  session: SessionState,
  options: FetchOptions = {},
): Promise<FetchPageResult> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS_PER_STEP;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const method = options.method ?? "GET";

  const redirectChain: RedirectEntry[] = [];
  let currentUrl = url;
  let currentSession = session;

  for (let i = 0; i <= maxRedirects; i++) {
    const headers = buildRequestHeaders(currentSession, currentUrl);

    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }
    if (options.extraHeaders) {
      for (const [k, v] of Object.entries(options.extraHeaders)) {
        headers[k] = v;
      }
    }

    // Only send body on the first request (not on redirect follows)
    const isFirstRequest = i === 0;
    const fetchInit: RequestInit = {
      method: isFirstRequest ? method : "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (isFirstRequest && options.body) {
      fetchInit.body = options.body;
    }

    const response = await fetch(currentUrl, fetchInit);

    // Capture Set-Cookie headers
    const setCookies: string[] = [];
    const rawSetCookie = response.headers.getSetCookie?.();
    if (rawSetCookie) {
      setCookies.push(...rawSetCookie);
    }

    // Update session with new cookies
    currentSession = addCookiesFromHeaders(
      currentSession,
      setCookies,
      currentUrl,
    );

    // Check for redirect
    const isRedirect =
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location");

    if (isRedirect) {
      const location = response.headers.get("location")!;
      const nextUrl = new URL(location, currentUrl).toString();

      redirectChain.push({
        fromUrl: currentUrl,
        toUrl: nextUrl,
        statusCode: response.status,
      });

      // Consume response body to avoid memory leak
      await response.text();

      currentUrl = nextUrl;
      continue;
    }

    // Not a redirect — read body and return
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    // Build flat headers record
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      fetchResult: {
        url,
        finalUrl: currentUrl,
        statusCode: response.status,
        headers: responseHeaders,
        body,
        contentType,
        redirectChain,
        setCookies,
      },
      updatedSession: currentSession,
    };
  }

  // Exceeded max redirects
  throw new Error(
    `Max redirects (${maxRedirects}) exceeded fetching ${url}. ` +
      `Last redirect: ${redirectChain.at(-1)?.toUrl ?? url}`,
  );
}
