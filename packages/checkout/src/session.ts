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

  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless });
  } catch {
    // System Chrome unavailable — fall back to bundled Chromium.
    browser = await chromium.launch({ headless });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
