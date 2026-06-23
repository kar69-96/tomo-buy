import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DomainCache } from "@bloon/core";
import type { Page } from "@browserbasehq/stagehand";

// ---- CDP cookie response type ----

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: string;
}

// ---- Unsafe cookie patterns (never cache auth tokens) ----

const UNSAFE_COOKIE_PATTERNS: readonly string[] = [
  "session",
  "token",
  "auth",
  "csrf",
  "sid",
  "login",
  "jwt",
];

export function isSafeCookie(cookieName: string): boolean {
  const lower = cookieName.toLowerCase();
  return !UNSAFE_COOKIE_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ---- Domain extraction ----

export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---- Cache storage path ----

function getCacheDir(): string {
  const dataDir =
    process.env.BLOON_DATA_DIR || path.join(os.homedir(), ".bloon");
  return path.join(dataDir, "cache");
}

function getCachePath(domain: string): string {
  return path.join(getCacheDir(), `${domain}.json`);
}

// ---- Load / Save ----

export function loadDomainCache(domain: string): DomainCache | null {
  const filepath = getCachePath(domain);
  try {
    const data = fs.readFileSync(filepath, "utf-8");
    return JSON.parse(data) as DomainCache;
  } catch {
    return null;
  }
}

export function saveDomainCache(cache: DomainCache): void {
  const dir = getCacheDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filepath = getCachePath(cache.domain);
  const tmpPath = filepath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filepath);
}

// ---- Extract from browser (via CDP) ----

export async function extractDomainCache(
  page: Page,
  domain: string,
): Promise<DomainCache> {
  // Get cookies via CDP
  const { cookies: allCookies } = await page.sendCDP<{
    cookies: CdpCookie[];
  }>("Network.getCookies");

  const safeCookies = allCookies
    .filter((c) => isSafeCookie(c.name))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
    }));

  // Get localStorage via evaluate
  const localStorage = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) {
        items[key] = window.localStorage.getItem(key) || "";
      }
    }
    return items;
  });

  return {
    domain,
    cookies: safeCookies,
    localStorage:
      Object.keys(localStorage).length > 0 ? localStorage : undefined,
    updated_at: new Date().toISOString(),
  };
}

// ---- Inject into browser (via CDP) ----

export async function injectDomainCache(
  page: Page,
  cache: DomainCache,
): Promise<void> {
  // Set cookies via CDP
  for (const c of cache.cookies) {
    await page.sendCDP("Network.setCookie", {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
    });
  }

  // Note: localStorage injection is deferred — it must happen AFTER
  // navigating to the target domain (localStorage is domain-scoped).
  // Call injectLocalStorage() after page.goto().
}

export async function injectLocalStorage(
  page: Page,
  cache: DomainCache,
): Promise<void> {
  if (cache.localStorage && Object.keys(cache.localStorage).length > 0) {
    const items = cache.localStorage;
    await page.evaluate((ls: Record<string, string>) => {
      for (const [key, value] of Object.entries(ls)) {
        window.localStorage.setItem(key, value);
      }
    }, items);
  }
}
