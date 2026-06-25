// ---- Browser session lifecycle ----
//
// Two runtimes behind one BrowserSession contract (selected by getBrowserRuntime):
//   - "local" (default): local Chrome driven by Playwright. Prefers the system
//     Google Chrome channel; falls back to Playwright's bundled Chromium. Set
//     HEADLESS=false to watch the checkout happen in a real window.
//   - "browserbase": managed stealth Chrome in the cloud (the production-
//     recommended runtime). See browserbase-session.ts.
// The checkout loop never branches on the runtime — it only touches `page`.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getBrowserRuntime, type BrowserRuntime } from "@tomo/core";

export interface SessionOptions {
  /** Launch with a visible window. Overrides the HEADLESS env var when set. */
  headless?: boolean;
  /** Request advanced stealth (Browserbase runtime; no-op locally). */
  stealth?: boolean;
  /** Route through residential proxies (Browserbase runtime; no-op locally). */
  proxies?: boolean;
  /**
   * Target domain for this session. On the Browserbase (ideal) runtime this
   * selects/creates a persistent per-domain Context so safe state is replayed
   * server-side. Ignored by the local (debugging) runtime, which uses the file
   * cache in cache.ts instead.
   */
  domain?: string;
  logSession?: boolean;
}

/** A live browser session. Carries the page the checkout loop drives. */
export interface BrowserSession {
  id: string;
  replayUrl: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Which runtime backs this session (defaults to "local"). */
  runtime?: BrowserRuntime;
}

// Back-compat alias for call sites that referenced the old name.
export type BrowserbaseSession = BrowserSession;

let sessionCounter = 0;

function resolveHeadless(options?: SessionOptions): boolean {
  if (typeof options?.headless === "boolean") return options.headless;
  return process.env.HEADLESS !== "false";
}

export async function createSession(
  options?: SessionOptions,
): Promise<BrowserSession> {
  if (getBrowserRuntime() === "browserbase") {
    // Imported lazily so the local runtime never loads the cloud adapter.
    const { createBrowserbaseSession } = await import("./browserbase-session.js");
    const session = await createBrowserbaseSession(options);
    return { ...session, runtime: "browserbase" };
  }

  const headless = resolveHeadless(options);

  // Reuse a persisted browser profile when BROWSER_PROFILE_DIR is set. Some sites
  // bind a logged-in session to the browser PROFILE (localStorage/IndexedDB +
  // cookies), not portable cookies alone — so a freshly-seeded context reads as
  // logged-out. Pointing at a profile that a human already authenticated lets the
  // checkout run as that user. Generic; the dir is operator-provided, not per-site.
  const profileDir = process.env.BROWSER_PROFILE_DIR;
  if (profileDir) {
    const context = await chromium
      .launchPersistentContext(profileDir, {
        channel: "chrome",
        headless,
        args: ["--disable-blink-features=AutomationControlled"],
        viewport: { width: 1280, height: 900 },
      })
      .catch(() =>
        chromium.launchPersistentContext(profileDir, {
          headless,
          args: ["--disable-blink-features=AutomationControlled"],
          viewport: { width: 1280, height: 900 },
        }),
      );
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("dialog", (d) => {
      void d.accept().catch(() => {});
    });
    sessionCounter += 1;
    const browser = context.browser();
    return {
      id: `profile_${process.pid}_${sessionCounter}`,
      replayUrl: "",
      browser: browser as Browser,
      context,
      page,
      runtime: "local",
    };
  }

  // Minimal, generic anti-automation hardening. Many storefronts (esp. Shopify)
  // serve a blank page to obviously-automated Chrome. These are the standard,
  // site-agnostic mitigations — they reduce trivial detection but do NOT defeat
  // advanced bot defenses (use BROWSER_RUNTIME=browserbase or HEADLESS=false for
  // those). `--disable-blink-features=AutomationControlled` drops the headless
  // `navigator.webdriver` flag the most basic checks read.
  const launchArgs = ["--disable-blink-features=AutomationControlled"];

  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless, args: launchArgs });
  } catch {
    // System Chrome unavailable — fall back to bundled Chromium.
    browser = await chromium.launch({ headless, args: launchArgs });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Only override the UA when headless: real Chrome's headless UA contains
    // "HeadlessChrome" (an obvious tell), so we strip it. When headful we leave
    // the native UA untouched so it stays consistent with the sec-ch-ua client
    // hints Chrome sends (a hand-set UA that disagrees with those is itself a
    // tell). The version here tracks a recent stable Chrome.
    ...(headless
      ? {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        }
      : {}),
  });

  // Belt-and-suspenders: ensure navigator.webdriver is undefined on every page
  // (covers the bundled-Chromium fallback, which ignores the launch arg above).
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();

  // Auto-accept JS dialogs (e.g. an "added to cart" alert) so steps don't block.
  page.on("dialog", (d) => {
    void d.accept().catch(() => {});
  });

  sessionCounter += 1;
  const id = `local_${process.pid}_${sessionCounter}`;

  return { id, replayUrl: "", browser, context, page, runtime: "local" };
}

export async function destroySession(
  session: BrowserSession | undefined,
): Promise<void> {
  if (!session) return;
  try {
    await session.context.close();
  } catch {
    // never throw from cleanup
  }
  try {
    await session.browser.close();
  } catch {
    // never throw from cleanup
  }
  if (session.runtime === "browserbase") {
    const { releaseBrowserbaseSession } = await import("./browserbase-session.js");
    await releaseBrowserbaseSession(session.id);
  }
}

// Re-export the OpenRouter key accessor so existing imports keep working.
export { getOpenRouterKey } from "./llm.js";
