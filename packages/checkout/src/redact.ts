/**
 * Redacted screenshots for the vision-driven page-action loop.
 *
 * PRIME DIRECTIVE: the LLM never sees a card number, login secret, or raw
 * shipping PII. A naive screenshot would leak all three. This module captures a
 * screenshot with every sensitive region painted over by an opaque overlay, so
 * the model gets page LAYOUT (buttons, headings, modals, field positions) without
 * any secret pixels.
 *
 * What gets covered:
 *  - Inputs whose name/id/autocomplete/placeholder match a card field pattern
 *    (number, cvv, expiry, cardholder) — the PAN/CVV path.
 *  - Inputs whose current value matches a provided PII value (name, email,
 *    address, …) — the sanitized-PII boundary.
 *  - Iframes served by a known payment processor (Stripe/Braintree/Adyen/…),
 *    whose contents are cross-origin and can render card digits visually.
 *  - In `aggressive` mode (card-present pages), EVERY input and iframe — a
 *    belt-and-suspenders guarantee for the payment stage.
 *
 * The overlay is a transient, visual-only DOM addition removed immediately after
 * capture; no input value is ever mutated.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";

const REDACT_MARKER = "data-tomo-redact";

/**
 * Debug dump: when CHECKOUT_REDACT_DIR is set, every redacted screenshot the
 * model receives is also written to disk, so a human can confirm no secret pixel
 * survived. Off in production (env unset). Best-effort — never throws.
 */
let redactDumpSeq = 0;
function dumpForDebug(buf: Buffer, aggressive: boolean): void {
  const dir = process.env.CHECKOUT_REDACT_DIR;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const n = String(redactDumpSeq++).padStart(3, "0");
    const tag = aggressive ? "aggressive" : "std";
    writeFileSync(join(dir, `redact-${n}-${tag}.jpg`), buf);
  } catch {
    /* best-effort — a missing/unwritable dir must not break checkout */
  }
}

/**
 * Field-identifier patterns that signal a card/secret input. Site-agnostic, and
 * covers the standard HTML autocomplete tokens (cc-number, cc-exp, cc-csc,
 * cc-name) since those are the most reliable signal on real checkout forms.
 */
const CARD_FIELD_PATTERN =
  "(card.?num(ber)?|cc.?num(ber)?|ccnum|card.?cvv|cc.?cvv|cvv|cvc|cc.?csc|csc|security.?code|card.?exp|cc.?exp|exp.?date|exp.?month|exp.?year|expir|card.?holder|cardholder|cc.?name)";

/** `src` substrings of common payment-processor iframes. Generic, not per-site. */
const PAYMENT_IFRAME_PATTERN =
  "(stripe|braintree|braintreegateway|adyen|checkout\\.com|paypal|squareup|spreedly|recurly|payments?|cardinalcommerce|3ds|vantiv|worldpay)";

// Pure predicates — exported so the security-critical decisions are unit-testable
// without launching a browser. The in-page overlay code mirrors these via the
// pattern strings above (page.evaluate can't import module functions).

/** Does a field identifier (name/id/autocomplete/placeholder) look like a card field? */
export function isCardFieldIdent(ident: string): boolean {
  return new RegExp(CARD_FIELD_PATTERN, "i").test(ident);
}

/** Is an iframe `src` served by a known payment processor? */
export function isPaymentIframeSrc(src: string): boolean {
  return new RegExp(PAYMENT_IFRAME_PATTERN, "i").test(src);
}

/**
 * Keep only PII values long enough to be identifying. Short tokens like "US" /
 * "CA" would over-paint unrelated state/country selects, so they're dropped —
 * card data is covered by pattern/aggressive mode regardless, never by value.
 */
export function filterPiiValues(values: string[]): string[] {
  return values.filter((v) => v && v.length >= 4);
}

export interface RedactOptions {
  /** Real PII values to paint over wherever they appear in an input. */
  piiValues?: string[];
  /** Cover ALL inputs and iframes (use on payment pages where a PAN is present). */
  aggressive?: boolean;
  /** JPEG quality (lower = smaller payload / fewer image tokens). */
  quality?: number;
}

/**
 * Capture a viewport screenshot with sensitive regions overlaid. Returns a
 * base64 `data:` URL suitable for an LLM image part, or null on any failure
 * (callers fall back to a text-only decision — never to an unredacted shot).
 */
export async function captureRedactedScreenshot(
  page: Page,
  options: RedactOptions = {},
): Promise<string | null> {
  const piiValues = filterPiiValues(options.piiValues ?? []);
  const aggressive = options.aggressive ?? false;
  // Quality 80 (up from 60): small far-corner controls — a header "log in | sign up",
  // a compact menu — must stay legible for the model to aim a coordinate click. The
  // extra image-token cost is modest; an unreadable control is a wasted round.
  const quality = options.quality ?? 80;

  try {
    await page.evaluate(
      ({ piiValues, aggressive, marker, cardPat, payPat }) => {
        const cardRe = new RegExp(cardPat, "i");
        const payRe = new RegExp(payPat, "i");

        const cover = (el: Element): void => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          const d = document.createElement("div");
          d.setAttribute(marker, "1");
          d.style.cssText =
            `position:fixed;left:${r.left}px;top:${r.top}px;` +
            `width:${r.width}px;height:${r.height}px;` +
            `background:#000;z-index:2147483647;pointer-events:none;`;
          document.body.appendChild(d);
        };

        for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
          const ident = [
            el.getAttribute("name"),
            el.id,
            el.getAttribute("autocomplete"),
            el.getAttribute("placeholder"),
            el.getAttribute("aria-label"),
          ]
            .filter(Boolean)
            .join(" ");
          const value = (el as HTMLInputElement).value || "";
          const isCard = cardRe.test(ident);
          const isPii =
            value.length > 0 &&
            piiValues.some((v) => value === v || value.includes(v));
          if (aggressive || isCard || isPii) cover(el);
        }

        for (const f of Array.from(document.querySelectorAll("iframe"))) {
          const src = f.getAttribute("src") || "";
          if (aggressive || payRe.test(src)) cover(f);
        }
      },
      {
        piiValues,
        aggressive,
        marker: REDACT_MARKER,
        cardPat: CARD_FIELD_PATTERN,
        payPat: PAYMENT_IFRAME_PATTERN,
      },
    );

    // scale:"css" renders one image pixel per CSS pixel regardless of the
    // display's devicePixelRatio. Without it, a Retina/real-Chrome session (DPR=2,
    // common on the CDP path) produces a 2x image while page.mouse and
    // elementsFromPoint use CSS px — so the model's coordinate clicks land at half
    // position and hit nothing. On a DPR=1 display this is a no-op.
    const buf = await page.screenshot({ type: "jpeg", quality, scale: "css" });
    dumpForDebug(buf, aggressive);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    // Any failure → no screenshot. The decision proceeds text-only; we never
    // risk shipping an un-redacted capture.
    return null;
  } finally {
    // Always strip overlays, even if the screenshot threw.
    await page
      .evaluate((marker) => {
        document.querySelectorAll(`[${marker}]`).forEach((e) => e.remove());
      }, REDACT_MARKER)
      .catch(() => {});
  }
}
