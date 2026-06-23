/**
 * Per-flow HTTP session manager.
 *
 * Immutable — every mutation returns a new SessionState.
 * Each runHTTPCheckout() call creates its own SessionManager
 * with a fresh cookie jar. No shared mutable state between flows.
 *
 * ┌──────────────────────────────┐
 * │       SessionManager         │
 * │  cookies: CookieEntry[]      │
 * │  csrfToken: string?          │
 * │  authToken: string?          │
 * │  customHeaders: Record       │
 * │                              │
 * │  addCookies() → new state    │
 * │  setCsrf() → new state       │
 * │  getHeaders() → headers obj  │
 * └──────────────────────────────┘
 */

import type { SessionState, CookieEntry } from "./types.js";

// ---- Cookie parsing from Set-Cookie headers ----

export function parseSetCookieHeader(
  header: string,
  requestUrl: string,
): CookieEntry | null {
  const parts = header.split(";").map((p) => p.trim());
  const nameValue = parts[0];
  if (!nameValue) return null;

  const eqIdx = nameValue.indexOf("=");
  if (eqIdx === -1) return null;

  const name = nameValue.slice(0, eqIdx).trim();
  const value = nameValue.slice(eqIdx + 1).trim();
  if (!name) return null;

  let domain = "";
  let path = "/";
  let expires: number | undefined;
  let httpOnly = false;
  let secure = false;
  let sameSite: "Strict" | "Lax" | "None" | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const lower = part.toLowerCase();

    if (lower.startsWith("domain=")) {
      domain = part.slice(7).trim().replace(/^\./, "");
    } else if (lower.startsWith("path=")) {
      path = part.slice(5).trim();
    } else if (lower.startsWith("expires=")) {
      const date = new Date(part.slice(8).trim());
      if (!isNaN(date.getTime())) {
        expires = date.getTime() / 1000;
      }
    } else if (lower.startsWith("max-age=")) {
      const seconds = parseInt(part.slice(8).trim(), 10);
      if (!isNaN(seconds)) {
        expires = Date.now() / 1000 + seconds;
      }
    } else if (lower === "httponly") {
      httpOnly = true;
    } else if (lower === "secure") {
      secure = true;
    } else if (lower.startsWith("samesite=")) {
      const val = part.slice(9).trim();
      if (val.toLowerCase() === "strict") sameSite = "Strict";
      else if (val.toLowerCase() === "lax") sameSite = "Lax";
      else if (val.toLowerCase() === "none") sameSite = "None";
    }
  }

  // Default domain from request URL
  if (!domain) {
    try {
      domain = new URL(requestUrl).hostname;
    } catch {
      return null;
    }
  }

  return { name, value, domain, path, expires, httpOnly, secure, sameSite };
}

// ---- Cookie matching ----

function cookieMatchesDomain(
  cookie: CookieEntry,
  hostname: string,
): boolean {
  const cookieDomain = cookie.domain.toLowerCase();
  const host = hostname.toLowerCase();
  return host === cookieDomain || host.endsWith("." + cookieDomain);
}

function cookieMatchesPath(cookie: CookieEntry, pathname: string): boolean {
  return pathname.startsWith(cookie.path);
}

function isExpired(cookie: CookieEntry): boolean {
  if (cookie.expires === undefined) return false;
  return cookie.expires < Date.now() / 1000;
}

// ---- Create initial state ----

export function createSessionState(): SessionState {
  return {
    cookies: [],
    csrfToken: undefined,
    csrfTokenSource: undefined,
    authToken: undefined,
    customHeaders: {},
  };
}

// ---- Immutable state transitions ----

export function addCookiesFromHeaders(
  state: SessionState,
  setCookieHeaders: readonly string[],
  requestUrl: string,
): SessionState {
  if (setCookieHeaders.length === 0) return state;

  const newCookies: CookieEntry[] = [];
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookieHeader(header, requestUrl);
    if (parsed) newCookies.push(parsed);
  }

  if (newCookies.length === 0) return state;

  // Merge: new cookies replace existing ones with the same name+domain+path
  const existing = state.cookies.filter(
    (existing) =>
      !newCookies.some(
        (n) =>
          n.name === existing.name &&
          n.domain === existing.domain &&
          n.path === existing.path,
      ),
  );

  return {
    ...state,
    cookies: [...existing, ...newCookies],
  };
}

export function setCsrfToken(
  state: SessionState,
  token: string,
  source: string,
): SessionState {
  return { ...state, csrfToken: token, csrfTokenSource: source };
}

export function setAuthToken(
  state: SessionState,
  token: string,
): SessionState {
  return { ...state, authToken: token };
}

export function setCustomHeader(
  state: SessionState,
  name: string,
  value: string,
): SessionState {
  return {
    ...state,
    customHeaders: { ...state.customHeaders, [name]: value },
  };
}

// ---- Build headers for an outgoing request ----

const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

export function buildRequestHeaders(
  state: SessionState,
  requestUrl: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...BROWSER_HEADERS };

  // Inject cookies
  let hostname: string;
  let pathname: string;
  try {
    const url = new URL(requestUrl);
    hostname = url.hostname;
    pathname = url.pathname;
  } catch {
    return headers;
  }

  const matchingCookies = state.cookies.filter(
    (c) =>
      cookieMatchesDomain(c, hostname) &&
      cookieMatchesPath(c, pathname) &&
      !isExpired(c),
  );

  if (matchingCookies.length > 0) {
    headers["Cookie"] = matchingCookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  // Inject CSRF token
  if (state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }

  // Inject auth token
  if (state.authToken) {
    headers["Authorization"] = `Bearer ${state.authToken}`;
  }

  // Inject custom headers
  for (const [name, value] of Object.entries(state.customHeaders)) {
    headers[name] = value;
  }

  return headers;
}

// ---- Extract cookie value by name ----

export function getCookieValue(
  state: SessionState,
  name: string,
  hostname: string,
): string | null {
  const cookie = state.cookies.find(
    (c) =>
      c.name === name &&
      cookieMatchesDomain(c, hostname) &&
      !isExpired(c),
  );
  return cookie?.value ?? null;
}
