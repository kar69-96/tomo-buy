/**
 * Reusable CAPTCHA detection + wait utility.
 * Ported from packages/crawling/src/browserbase-adapter.ts:107-141
 * with enhancements for reCAPTCHA, hCaptcha, and Turnstile detection.
 */

import type { Page } from "@browserbasehq/stagehand";

const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Detects if the current page is showing a CAPTCHA challenge
 * (Cloudflare, reCAPTCHA, hCaptcha, Turnstile) and waits for
 * Browserbase's auto-solver to resolve it.
 */
export async function waitForCaptchaSolve(
  page: Page,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const isChallenge = await page
    .evaluate(() => {
      const title = document.title.toLowerCase();
      const body = document.body?.innerText?.toLowerCase() ?? "";

      // Cloudflare
      if (title.includes("just a moment") || title.includes("attention required")) return true;
      if (document.querySelector("#challenge-running, #challenge-stage, #cf-challenge-running")) return true;

      // Generic bot detection
      if (title.includes("access denied") || body.includes("automated access")) return true;
      if (body.includes("please verify you are a human") || body.includes("checking your browser")) return true;

      // reCAPTCHA
      if (document.querySelector(".g-recaptcha, #recaptcha, [data-sitekey]")) return true;

      // hCaptcha
      if (document.querySelector(".h-captcha, [data-hcaptcha-sitekey]")) return true;

      // Turnstile
      if (document.querySelector(".cf-turnstile, [data-turnstile-sitekey]")) return true;

      return false;
    })
    .catch(() => false);

  if (!isChallenge) return;

  const startUrl = page.url();
  console.log(`  [checkout] CAPTCHA detected on ${startUrl} — waiting for Browserbase to solve`);

  // Poll until challenge is resolved or timeout
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resolved = await page
      .evaluate(() => {
        const title = document.title.toLowerCase();
        return (
          !title.includes("just a moment") &&
          !title.includes("attention required") &&
          !document.querySelector(
            "#challenge-running, #challenge-stage, .g-recaptcha, .h-captcha, .cf-turnstile",
          )
        );
      })
      .catch(() => false);

    if (resolved) break;

    // Check for URL change (redirect after solve)
    if (page.url() !== startUrl) break;

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  // Wait for page to settle after challenge resolution
  await page.waitForLoadState("domcontentloaded", 10_000).catch(() => {});
}
