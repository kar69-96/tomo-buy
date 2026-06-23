/**
 * Rendered-page extraction tier: when static fetch fails (JS-rendered or
 * lightly bot-gated pages), render the page with LOCAL Playwright (Chrome),
 * try the pure extractors first, then fall back to OpenRouter on the markdown.
 *
 * (Historically this used the Browserbase adapter + Gemini. The exported names
 * are preserved so the discovery pipeline is unchanged.)
 */

import { chromium, type Browser } from "playwright-core";
import type { FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_PROMPT,
  ProductNotFoundError,
  ProductBlockedError,
  classifyContent,
} from "./constants.js";
import { isRedirectToOtherPage } from "./helpers.js";
import {
  extractJsonLdFromHtml,
  extractMetaFromHtml,
  extractViaCssSelectors,
  htmlToMarkdown,
} from "./html-extract.js";
import { completeJson } from "./llm.js";

const MIN_HTML_LENGTH = 500;

export type BrowserbaseFailureCode =
  | "blocked"
  | "not_found"
  | "render_timeout"
  | "adapter_502"
  | "extract_empty"
  | "transport_error";

export interface BrowserbaseFailure {
  code: BrowserbaseFailureCode;
  detail?: string;
}

export interface BrowserbaseExtractResult {
  extract: FirecrawlExtract | null;
  failure: BrowserbaseFailure | null;
}

let lastFailure: BrowserbaseFailure | null = null;

// ---- Step 1: Fetch rendered HTML via local Playwright Chrome ----

export interface RenderedPage {
  html: string;
  finalUrl: string;
}

async function launchBrowser(): Promise<Browser> {
  const headless = process.env.HEADLESS !== "false";
  try {
    return await chromium.launch({ channel: "chrome", headless });
  } catch {
    return await chromium.launch({ headless });
  }
}

export async function fetchRenderedHtml(
  url: string,
  timeoutMs = 60_000,
): Promise<RenderedPage> {
  lastFailure = null;
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForTimeout(2500);

    const status = response?.status() ?? 0;
    if (status === 404 || status === 410) {
      lastFailure = { code: "not_found", detail: `page status ${status}` };
      throw new ProductNotFoundError(`Page returned HTTP ${status}`);
    }
    if (status === 401 || status === 403 || status === 429) {
      lastFailure = { code: "blocked", detail: `page status ${status}` };
      throw new ProductBlockedError(`Page blocked with HTTP ${status}`);
    }

    const html = await page.content();
    const finalUrl = page.url();

    if (html.length < MIN_HTML_LENGTH) {
      lastFailure = { code: "extract_empty", detail: `html too short (${html.length})` };
      throw new Error(`HTML too short (${html.length} chars)`);
    }

    const classification = classifyContent(html, 20000);
    if (classification === "blocked") {
      lastFailure = { code: "blocked", detail: "blocked pattern detected in rendered html" };
      throw new ProductBlockedError("Page still bot-blocked after render");
    }
    if (classification === "not_found") {
      lastFailure = { code: "not_found", detail: "not_found pattern detected in rendered html" };
      throw new ProductNotFoundError("Page content indicates product not found");
    }

    return { html, finalUrl };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

// ---- Step 2: OpenRouter extraction on markdown ----

const EXTRACT_SYSTEM =
  `${FIRECRAWL_EXTRACT_PROMPT}\n\n` +
  "Return a JSON object with these fields (omit unknown ones): " +
  '{"name": string, "price": string (digits only, no currency symbol), ' +
  '"original_price"?: string, "currency"?: string, "brand"?: string, ' +
  '"image_url"?: string, "description"?: string, ' +
  '"options"?: [{"name": string, "values": string[]}], "variant_urls"?: string[]}. ' +
  "Return ONLY the JSON object.";

async function extractWithOpenRouter(markdown: string): Promise<FirecrawlExtract | null> {
  try {
    const parsed = await completeJson<FirecrawlExtract>(
      EXTRACT_SYSTEM,
      `Page content:\n${markdown}`,
      { timeoutMs: 25_000 },
    );
    if (!parsed || !parsed.name || !parsed.price) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---- Orchestrators (names preserved for the discovery pipeline) ----

export async function browserbaseExtract(
  url: string,
  timeoutMs = 90_000,
): Promise<FirecrawlExtract | null> {
  const { extract } = await browserbaseExtractWithFailure(url, timeoutMs);
  return extract;
}

export async function browserbaseExtractWithFailure(
  url: string,
  timeoutMs = 90_000,
): Promise<BrowserbaseExtractResult> {
  try {
    console.log(`  [render-extract] Rendering ${url} via local Chrome`);
    const { html, finalUrl } = await fetchRenderedHtml(url, timeoutMs);

    if (isRedirectToOtherPage(url, finalUrl)) {
      const failure: BrowserbaseFailure = {
        code: "extract_empty",
        detail: `redirected from ${url} to ${finalUrl}`,
      };
      lastFailure = failure;
      return { extract: null, failure };
    }

    // Pure extractors first (fast, reliable)
    const jsonLdExtract = extractJsonLdFromHtml(html);
    if (jsonLdExtract?.name && jsonLdExtract?.price) {
      console.log(`  [render-extract] JSON-LD: ${jsonLdExtract.name} — ${jsonLdExtract.price}`);
      return { extract: jsonLdExtract, failure: null };
    }
    const metaExtract = extractMetaFromHtml(html);
    if (metaExtract?.name && metaExtract?.price) {
      console.log(`  [render-extract] Meta: ${metaExtract.name} — ${metaExtract.price}`);
      return { extract: metaExtract, failure: null };
    }
    const cssExtract = extractViaCssSelectors(html);
    if (cssExtract?.name && cssExtract?.price) {
      console.log(`  [render-extract] CSS: ${cssExtract.name} — ${cssExtract.price}`);
      return { extract: cssExtract, failure: null };
    }

    // Fall back to OpenRouter on the markdown
    const markdown = htmlToMarkdown(html);
    console.log(`  [render-extract] Extracting via OpenRouter (${markdown.length} chars)`);
    const extract = await extractWithOpenRouter(markdown);

    if (!extract?.name || !extract?.price) {
      const failure: BrowserbaseFailure = {
        code: "extract_empty",
        detail: "OpenRouter returned no name/price",
      };
      lastFailure = failure;
      return { extract: null, failure };
    }

    console.log(`  [render-extract] Success: ${extract.name} — ${extract.price}`);
    return { extract, failure: null };
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof ProductBlockedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    let failure: BrowserbaseFailure;
    if (message.includes("imeout")) {
      failure = { code: "render_timeout", detail: message };
    } else {
      failure = lastFailure ?? { code: "transport_error", detail: message };
    }
    lastFailure = failure;
    console.log(`  [render-extract] Failed: ${message}`);
    return { extract: null, failure };
  }
}
