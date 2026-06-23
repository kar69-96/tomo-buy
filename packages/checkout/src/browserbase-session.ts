/**
 * Browserbase browser runtime (the production-recommended runtime, see README:
 * "Recommended tooling"). Browserbase provisions a managed stealth Chrome in the
 * cloud and hands back a CDP endpoint; we drive it with the SAME Playwright API
 * as the local runtime, so the checkout loop never branches on where the browser
 * lives. Runtime selection happens in session.ts via getBrowserRuntime().
 *
 * Stub status: the session-create + connectOverCDP wiring is real (fetch against
 * the Browserbase REST API, no SDK dependency), but it has not been exercised
 * end-to-end. It stays dormant unless BROWSER_RUNTIME=browserbase AND
 * BROWSERBASE_API_KEY are both set; otherwise the local Playwright runtime
 * (session.ts) handles everything and the repo runs out of the box.
 */

import { chromium, type Browser } from "playwright";
import {
  getBrowserbaseKey,
  getBrowserbaseProjectId,
} from "@tomo/core";
import type { BrowserSession, SessionOptions } from "./session.js";
import { resolveContextId, buildContextSetting } from "./browserbase-cache.js";

const BROWSERBASE_API = "https://api.browserbase.com/v1";

interface CreateSessionResponse {
  id: string;
  connectUrl: string;
}

/**
 * Build the create-session request body (pure / testable). Stealth + proxies map
 * onto Browserbase's advanced-stealth + residential-proxy settings; both default
 * on, matching the README's "stealth mode" recommendation.
 */
export function buildSessionRequest(
  projectId: string,
  options?: SessionOptions,
  contextId?: string | null,
): Record<string, unknown> {
  const browserSettings: Record<string, unknown> = {
    // Advanced stealth survives bot detection at scale (Scale-plan feature).
    advancedStealth: options?.stealth ?? true,
    viewport: { width: 1280, height: 900 },
  };
  // IDEAL-tooling per-domain cache: boot from a persistent Context (see
  // browserbase-cache.ts) and save state back to it when the session ends.
  if (contextId) {
    browserSettings.context = buildContextSetting(contextId, true);
  }
  return {
    projectId,
    proxies: options?.proxies ?? true,
    browserSettings,
  };
}

/** The session-inspector / live-view URL for a Browserbase session (pure). */
export function replayUrlFor(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${sessionId}`;
}

async function createRemoteSession(
  apiKey: string,
  projectId: string,
  options?: SessionOptions,
  contextId?: string | null,
): Promise<CreateSessionResponse> {
  const res = await fetch(`${BROWSERBASE_API}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
    },
    body: JSON.stringify(buildSessionRequest(projectId, options, contextId)),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Browserbase ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const data = (await res.json()) as Partial<CreateSessionResponse>;
  if (!data.id || !data.connectUrl) {
    throw new Error("Browserbase session-create returned no id/connectUrl");
  }
  return { id: data.id, connectUrl: data.connectUrl };
}

/**
 * Create a checkout session backed by Browserbase. Returns the same
 * BrowserSession shape as the local runtime so callers are unchanged.
 */
export async function createBrowserbaseSession(
  options?: SessionOptions,
): Promise<BrowserSession> {
  const apiKey = getBrowserbaseKey();
  const projectId = getBrowserbaseProjectId();
  if (!apiKey || !projectId) {
    throw new Error(
      "Browserbase runtime requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID",
    );
  }

  // IDEAL-tooling per-domain cache: reuse (or create) a persistent Context for
  // this domain so safe state replays server-side. Best-effort — a null id just
  // boots a fresh session. See browserbase-cache.ts.
  const contextId = options?.domain
    ? await resolveContextId(options.domain, apiKey, projectId)
    : null;

  const { id, connectUrl } = await createRemoteSession(
    apiKey,
    projectId,
    options,
    contextId,
  );

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(connectUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Browserbase CDP connect failed (session ${id}): ${msg}`);
  }

  // Browserbase hands back a default context + page; reuse them.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  // Auto-accept JS dialogs so checkout steps don't block (parity with local).
  page.on("dialog", (d) => {
    void d.accept().catch(() => {});
  });

  return { id, replayUrl: replayUrlFor(id), browser, context, page };
}

/** Best-effort release of a Browserbase session (never throws). */
export async function releaseBrowserbaseSession(sessionId: string): Promise<void> {
  const apiKey = getBrowserbaseKey();
  const projectId = getBrowserbaseProjectId();
  if (!apiKey || !projectId || !sessionId) return;
  try {
    await fetch(`${BROWSERBASE_API}/sessions/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": apiKey,
      },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    });
  } catch {
    // never throw from cleanup
  }
}
