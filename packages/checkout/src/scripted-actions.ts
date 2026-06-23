/**
 * Zero-LLM DOM manipulation functions for checkout automation.
 * All functions use page.evaluate() — no LLM calls.
 *
 * Classification signal constants live in @bloon/core/classification-signals
 * and are shared with the HTTP engine's cheerio-based classifier.
 */
import type { Page } from "@browserbasehq/stagehand";
import { scanIframesForCardFields } from "./agent-tools.js";
import {
  type PageType,
  CARD_SELECTORS,
  CARD_FIELD_MAP,
  EXPIRY_MONTH_SELECTORS,
  EXPIRY_YEAR_SELECTORS,
} from "@bloon/core";

export type { PageType } from "@bloon/core";

// ---- Scripted popup dismissal ----

export async function scriptedDismissPopups(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|turnstile/i;
    const actions: string[] = [];

    // Click close/dismiss buttons in dialogs
    document.querySelectorAll(
      '[role="dialog"] button[aria-label*="close" i], ' +
      '[role="dialog"] button[aria-label*="dismiss" i], ' +
      'button[aria-label*="close" i][class*="modal" i], ' +
      '.modal button.close, .modal .btn-close'
    ).forEach(btn => {
      const dialog = btn.closest('[role="dialog"], .modal');
      if (!CAPTCHA_RE.test(dialog?.textContent || "")) {
        (btn as HTMLElement).click();
        actions.push("clicked close button");
      }
    });

    // Remove cookie/consent banners
    document.querySelectorAll('[class*="cookie" i], [id*="cookie" i], [class*="consent" i]')
      .forEach(e => { e.remove(); actions.push("removed cookie banner"); });

    // Remove fixed overlays
    document.querySelectorAll('.overlay, .backdrop, [class*="overlay" i], [class*="backdrop" i]')
      .forEach(e => {
        if (!CAPTCHA_RE.test(e.textContent || "") && getComputedStyle(e).position === "fixed") {
          e.remove();
          actions.push("removed overlay");
        }
      });

    // Press Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    actions.push("pressed Escape");

    return actions;
  });
}

// ---- Scripted shipping fill ----

interface ShippingData {
  email: string;
  firstName: string;
  lastName: string;
  street: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
}

export async function scriptedFillShipping(
  page: Page,
  data: ShippingData,
): Promise<string[]> {
  const filled = await page.evaluate((d) => {
    const results: string[] = [];

    function find(selectors: string[]): HTMLInputElement | HTMLSelectElement | null {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el as HTMLInputElement | HTMLSelectElement;
      }
      return null;
    }

    function fillInput(el: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    function fillSelect(el: HTMLSelectElement, value: string) {
      for (const opt of el.options) {
        if (
          opt.value === value ||
          opt.text.trim() === value ||
          opt.value.toLowerCase().includes(value.toLowerCase()) ||
          opt.text.toLowerCase().includes(value.toLowerCase())
        ) {
          el.value = opt.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    // Email
    const email = find([
      'input[autocomplete="email"]', 'input[type="email"]',
      'input[name*="email" i]', 'input[id*="email" i]',
    ]);
    if (email) { fillInput(email as HTMLInputElement, d.email); results.push("email"); }

    // Combined full name (many stores use a single name field)
    const fullName = find([
      'input[autocomplete="name"]', 'input[name*="fullName" i]',
      'input[name*="full_name" i]', 'input[name="name"]',
      'input[id*="fullName" i]',
    ]);
    if (fullName) {
      fillInput(fullName as HTMLInputElement, `${d.firstName} ${d.lastName}`.trim());
      results.push("fullName");
    }

    // First name (skip if full name was already filled)
    const fn = !fullName ? find([
      'input[autocomplete="given-name"]', 'input[name*="firstName" i]',
      'input[name*="first_name" i]', 'input[id*="firstName" i]',
      'input[name*="first-name" i]',
    ]) : null;
    if (fn) { fillInput(fn as HTMLInputElement, d.firstName); results.push("firstName"); }

    // Last name (skip if full name was already filled)
    const ln = !fullName ? find([
      'input[autocomplete="family-name"]', 'input[name*="lastName" i]',
      'input[name*="last_name" i]', 'input[id*="lastName" i]',
      'input[name*="last-name" i]',
    ]) : null;
    if (ln) { fillInput(ln as HTMLInputElement, d.lastName); results.push("lastName"); }

    // Address
    const addr = find([
      'input[autocomplete="address-line1"]', 'input[name*="address1" i]',
      'input[name*="street" i]', 'input[id*="address1" i]',
      'input[name*="line1" i]', 'input[name*="streetAddress" i]',
      'input[name*="address_1" i]', 'input[name*="addr1" i]',
      'input[name="address" i]', 'input[id="address" i]',
    ]);
    if (addr) { fillInput(addr as HTMLInputElement, d.street); results.push("address"); }

    // Apartment
    const apt = find([
      'input[autocomplete="address-line2"]', 'input[name*="address2" i]',
      'input[name*="apartment" i]', 'input[id*="address2" i]', 'input[id*="apartment" i]',
      'input[name*="line2" i]', 'input[name*="address_2" i]', 'input[name*="apt" i]',
    ]);
    if (apt && d.apartment) { fillInput(apt as HTMLInputElement, d.apartment); results.push("apartment"); }

    // City
    const city = find([
      'input[autocomplete="address-level2"]', 'input[name*="city" i]', 'input[id*="city" i]',
    ]);
    if (city) { fillInput(city as HTMLInputElement, d.city); results.push("city"); }

    // State — try select first, then input (many stores use text input for state)
    const stateSelect = find([
      'select[autocomplete="address-level1"]', 'select[name*="zone" i]',
      'select[name*="state" i]', 'select[name*="province" i]',
      'select[name*="region" i]',
    ]);
    if (stateSelect) {
      if (fillSelect(stateSelect as HTMLSelectElement, d.state)) results.push("state");
    } else {
      const stateInput = find([
        'input[autocomplete="address-level1"]', 'input[name*="state" i]',
        'input[name*="province" i]', 'input[name*="region" i]',
        'input[id*="state" i]',
      ]);
      if (stateInput) { fillInput(stateInput as HTMLInputElement, d.state); results.push("state"); }
    }

    // ZIP
    const zip = find([
      'input[autocomplete="postal-code"]', 'input[name*="zip" i]',
      'input[name*="postal" i]', 'input[id*="zip" i]',
      'input[name*="postalCode" i]', 'input[name*="zipCode" i]',
    ]);
    if (zip) { fillInput(zip as HTMLInputElement, d.zip); results.push("zip"); }

    // Country — try select first, then input
    const countrySelect = find([
      'select[autocomplete="country"]', 'select[name*="country" i]',
      'select[id*="country" i]',
    ]);
    if (countrySelect && d.country) {
      if (fillSelect(countrySelect as HTMLSelectElement, d.country)) results.push("country");
    } else {
      const countryInput = find([
        'input[autocomplete="country"]', 'input[name*="country" i]',
        'input[id*="country" i]',
      ]);
      if (countryInput && d.country) {
        fillInput(countryInput as HTMLInputElement, d.country);
        results.push("country");
      }
    }

    // Phone
    const phone = find([
      'input[autocomplete="tel"]', 'input[type="tel"]',
      'input[name*="phone" i]', 'input[id*="phone" i]',
    ]);
    if (phone) { fillInput(phone as HTMLInputElement, d.phone); results.push("phone"); }

    return results;
  }, data);

  // Dismiss autocomplete popups after filling
  if (filled.length > 0) {
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      document.querySelectorAll(
        '[role="dialog"] button[aria-label*="close" i], ' +
        '[role="dialog"] button[aria-label*="dismiss" i]'
      ).forEach(btn => {
        const dialog = btn.closest('[role="dialog"]');
        const text = dialog?.textContent?.toLowerCase() || "";
        if (!/captcha|recaptcha|hcaptcha|turnstile/i.test(text)) {
          (btn as HTMLElement).click();
        }
      });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  return filled;
}

// ---- Scripted card field fill (main page CSS selectors + iframe fallback) ----

export async function scriptedFillCardFields(
  page: Page,
  cdpCreds: Record<string, string>,
): Promise<{ filled: number; method: "main-page" | "iframe" | "none" }> {
  // 1. Try main-page CSS selectors first
  // Helper: fill with a short timeout to avoid hanging
  async function fillWithTimeout(locator: ReturnType<typeof page.locator>, value: string, ms = 1500): Promise<boolean> {
    try {
      await Promise.race([
        locator.fill(value),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fill timeout")), ms)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  let mainPageFilled = 0;
  for (const { selector, credKey } of CARD_FIELD_MAP) {
    const value = cdpCreds[credKey];
    if (!value) continue;
    try {
      const el = page.locator(selector).first();
      if (await fillWithTimeout(el, value)) mainPageFilled++;
    } catch {
      // Field not found on main page
    }
  }

  // 2. Handle separated month/year expiry fields (Stripe, Square, Adyen)
  const expiry = cdpCreds.x_card_expiry;
  if (expiry) {
    const [rawMonth, rawYear] = expiry.split("/");
    const month = rawMonth?.trim() ?? "";
    const year = rawYear?.trim() ?? "";
    // Expand 2-digit year to 4-digit
    const fullYear = year.length === 2 ? `20${year}` : year;

    let filledSplit = false;
    for (const sel of EXPIRY_MONTH_SELECTORS) {
      const el = page.locator(sel).first();
      if (await fillWithTimeout(el, month)) {
        filledSplit = true;
        break;
      }
    }
    if (filledSplit) {
      for (const sel of EXPIRY_YEAR_SELECTORS) {
        const el = page.locator(sel).first();
        if (await fillWithTimeout(el, fullYear) || await fillWithTimeout(el, year)) {
          mainPageFilled += 2; // month + year
          break;
        }
      }
    }
  }

  // Need at least 2 fields (card number + one more) to count as main-page success
  if (mainPageFilled >= 2) {
    return { filled: mainPageFilled, method: "main-page" };
  }

  // 3. Iframe fallback — try even if 1 main-page field was found (likely a false positive)
  const iframeResult = await scanIframesForCardFields(page, cdpCreds);
  if (iframeResult.filled > 0) {
    return { filled: iframeResult.filled + mainPageFilled, method: "iframe" };
  }

  // If main page got at least 1, report that
  if (mainPageFilled > 0) {
    return { filled: mainPageFilled, method: "main-page" };
  }

  return { filled: 0, method: "none" };
}

// ---- Scripted billing fill ----

interface BillingData {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export async function scriptedFillBilling(
  page: Page,
  data: BillingData,
): Promise<string[]> {
  return page.evaluate((d) => {
    const results: string[] = [];

    function find(selectors: string[]): HTMLInputElement | HTMLSelectElement | null {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el as HTMLInputElement | HTMLSelectElement;
      }
      return null;
    }

    function fillInput(el: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    function fillSelect(el: HTMLSelectElement, value: string) {
      for (const opt of el.options) {
        if (
          opt.value === value ||
          opt.text.trim() === value ||
          opt.value.toLowerCase().includes(value.toLowerCase()) ||
          opt.text.toLowerCase().includes(value.toLowerCase())
        ) {
          el.value = opt.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    // Billing-specific selectors (look for "billing" in name/id, or second address group)
    const street = find([
      'input[name*="billing"][name*="address" i]', 'input[name*="billing"][name*="street" i]',
      'input[id*="billing"][id*="address" i]',
    ]);
    if (street) { fillInput(street as HTMLInputElement, d.street); results.push("billing_street"); }

    const city = find([
      'input[name*="billing"][name*="city" i]', 'input[id*="billing"][id*="city" i]',
    ]);
    if (city) { fillInput(city as HTMLInputElement, d.city); results.push("billing_city"); }

    const state = find([
      'select[name*="billing"][name*="state" i]', 'select[name*="billing"][name*="zone" i]',
      'select[name*="billing"][name*="province" i]',
    ]);
    if (state) {
      if (fillSelect(state as HTMLSelectElement, d.state)) results.push("billing_state");
    }

    const zip = find([
      'input[name*="billing"][name*="zip" i]', 'input[name*="billing"][name*="postal" i]',
      'input[id*="billing"][id*="zip" i]',
    ]);
    if (zip) { fillInput(zip as HTMLInputElement, d.zip); results.push("billing_zip"); }

    return results;
  }, data);
}

// ---- Uncheck "billing same as shipping" ----

export async function scriptedUncheckBillingSameAsShipping(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const label = cb.labels?.[0]?.textContent?.toLowerCase() ?? "";
      const name = (cb.name + cb.id).toLowerCase();
      if (
        label.includes("same as shipping") ||
        label.includes("billing") ||
        name.includes("billing_same") ||
        name.includes("same_as_shipping")
      ) {
        if (cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  });
}

// ---- Scripted button click ----

export async function scriptedClickButton(
  page: Page,
  target: string,
): Promise<boolean> {
  const clicked = await page.evaluate((t) => {
    const lower = t.toLowerCase();
    // Try multiple text fragments separated by /
    const alternatives = lower.split("/").map(s => s.trim());

    // Word-level match: "add to cart" matches "Add 4 Items to Cart"
    // by checking that all words from the target appear in order in the text
    function wordsMatch(haystack: string, needle: string): boolean {
      const needleWords = needle.split(/\s+/);
      let pos = 0;
      for (const word of needleWords) {
        const idx = haystack.indexOf(word, pos);
        if (idx === -1) return false;
        pos = idx + word.length;
      }
      return true;
    }

    const candidates = document.querySelectorAll(
      'button, a[role="button"], input[type="submit"], [role="button"], a.btn, a.button, ' +
      'label[role="button"], div[role="button"], span[role="button"], a[href]'
    );

    for (const el of candidates) {
      const htmlEl = el as HTMLElement;

      // Skip disabled or hidden buttons
      const style = getComputedStyle(htmlEl);
      const isFixedOrSticky = style.position === "fixed" || style.position === "sticky";
      if (
        (el as HTMLButtonElement).disabled ||
        htmlEl.getAttribute("aria-disabled") === "true" ||
        // offsetParent is null for fixed/sticky elements — don't skip those
        (!isFixedOrSticky && htmlEl.offsetParent === null) ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) continue;

      const text = (el.textContent || "").trim().toLowerCase();
      const value = (el as HTMLInputElement).value?.toLowerCase() || "";
      const label = el.getAttribute("aria-label")?.toLowerCase() || "";
      const testId = el.getAttribute("data-testid")?.toLowerCase() || "";
      const title = el.getAttribute("title")?.toLowerCase() || "";
      const allText = `${text} ${value} ${label} ${testId} ${title}`;

      // Exact substring match OR word-level match (handles "Add 4 Items to Cart")
      const match = alternatives.some(alt =>
        allText.includes(alt) || wordsMatch(allText, alt)
      );
      if (!match) continue;

      // Check for inline onclick handler
      const onclick = el.getAttribute("onclick");
      if (onclick) {
        try {
          new Function(onclick).call(el);
          return true;
        } catch {
          // Fall through to regular click
        }
      }
      htmlEl.click();
      return true;
    }
    return false;
  }, target);

  if (clicked) {
    try {
      await page.waitForTimeout(3000);
    } catch {
      // Page may have navigated
    }
  }
  return clicked;
}

// ---- Scripted radio/checkbox option selection ----

export async function scriptedSelectOption(
  page: Page,
  labelOrValue: string,
  type: "radio" | "checkbox" = "radio",
): Promise<boolean> {
  return page.evaluate(
    ({ target, inputType }) => {
      const lower = target.toLowerCase();

      // 1. Native input[type="radio"] or input[type="checkbox"]
      const inputs = document.querySelectorAll<HTMLInputElement>(`input[type="${inputType}"]`);
      for (const input of inputs) {
        const label = input.labels?.[0]?.textContent?.toLowerCase() ?? "";
        const val = input.value.toLowerCase();
        const id = input.id.toLowerCase();
        // Also check parent element text (for inputs without proper <label> association)
        const parentText = input.parentElement?.textContent?.toLowerCase() ?? "";
        // Check aria-label on the input itself
        const ariaLabel = input.getAttribute("aria-label")?.toLowerCase() ?? "";
        if (label.includes(lower) || val.includes(lower) || id.includes(lower) ||
            parentText.includes(lower) || ariaLabel.includes(lower)) {
          input.click();
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }

      // 2. Custom [role="radio"] or [role="checkbox"] elements
      const role = inputType === "radio" ? "radio" : "checkbox";
      const customEls = document.querySelectorAll(`[role="${role}"]`);
      for (const el of customEls) {
        const text = (el.textContent || "").trim().toLowerCase();
        const val = el.getAttribute("value")?.toLowerCase() || "";
        const label = el.getAttribute("aria-label")?.toLowerCase() || "";
        if (text.includes(lower) || val.includes(lower) || label.includes(lower)) {
          (el as HTMLElement).click();
          return true;
        }
      }

      // 3. Clickable elements containing the target text (buttons, labels, etc.)
      const clickables = document.querySelectorAll(
        'button, label, [role="button"], [class*="option" i], [class*="amount" i]'
      );
      for (const el of clickables) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (text === lower || text.includes(lower)) {
          (el as HTMLElement).click();
          return true;
        }
      }

      return false;
    },
    { target: labelOrValue, inputType: type },
  );
}

// ---- Page type detection ----

export async function detectPageType(page: Page): Promise<PageType> {
  const evalBody = ({ cardSelectors }: { cardSelectors: string[] }) => {
      const text = (document.body.textContent || "").toLowerCase();
      const url = window.location.href.toLowerCase();

      // Donation landing page (check BEFORE confirmation — donation pages have "thank you" text)
      const donationSignals = [
        "donate", "donation", "contribution", "give now",
      ];
      const donationCount = donationSignals.filter(s => text.includes(s)).length;
      const hasDonateButton = !!document.querySelector(
        'button[value*="donate" i], a[href*="donate" i], input[value*="donate" i]'
      );
      const hasDonationAmounts = !!document.querySelector(
        '[class*="amount" i], [name*="amount" i], input[type="radio"][name*="amount" i]'
      );
      const isDonationSite = url.includes("donate") || url.includes("donation");
      if ((donationCount >= 2 && (hasDonateButton || hasDonationAmounts)) || isDonationSite) {
        // Check if this is actually the payment gateway (has card fields)
        const hasCardFields = cardSelectors.some(sel =>
          document.querySelector(sel) !== null
        );
        const hasIframes = document.querySelectorAll("iframe").length > 0;
        if (hasCardFields || hasIframes) {
          return "payment-gateway" as const;
        }
        return "donation-landing" as const;
      }

      // Confirmation page (after donation check to avoid false positives on donation landing)
      const confirmSignals = [
        "thank you for your order", "order confirmed", "order number",
        "confirmation number", "order placed", "purchase complete",
        "successfully placed", "thank you for your donation",
        "we received your order", "your order has been",
      ];
      const confirmCount = confirmSignals.filter(s => text.includes(s)).length;
      // Require strong signals: ≥2 matches OR URL-based confirmation
      const isConfirmUrl = url.includes("/confirmation") || url.includes("/thank-you") ||
        url.includes("/order-complete") || url.includes("/order-confirmation");
      if (confirmCount >= 2 || (confirmCount >= 1 && isConfirmUrl)) {
        // Check for error signals even on apparent confirmation pages
        // "Your order could not be placed" contains "order" but is an error
        const errorTextSignals = [
          // Payment declines
          "card was declined", "card has been declined", "payment was declined",
          "payment declined", "transaction was declined", "transaction declined",
          "your card was denied", "payment was not successful",
          "unable to process your payment", "could not process your payment",
          "payment could not be completed", "we couldn't process your payment",
          // Card validation
          "invalid card number", "card number is invalid", "card has expired",
          "incorrect cvc", "incorrect cvv", "security code is incorrect",
          "card was not accepted", "card is not supported",
          // Order-level errors
          "order could not be placed", "order could not be completed",
          "unable to place your order", "unable to complete your order",
          "we were unable to process", "there was a problem with your order",
          // Out of stock
          "sold out", "out of stock", "no longer available", "item is unavailable",
          // Generic checkout errors
          "something went wrong", "an error occurred", "please try again",
          "transaction failed", "payment failed", "purchase failed",
          "insufficient funds", "do not honor",
        ];
        const errorOnConfirmCount = errorTextSignals.filter(s => text.includes(s)).length;
        if (errorOnConfirmCount === 0) {
          return "confirmation" as const;
        }
        // Error signals found on confirmation-like page → fall through to error check
      }

      // Shared signals used by multiple detectors
      const hasCardFields = cardSelectors.some(sel =>
        document.querySelector(sel) !== null
      );
      const paymentIframeSignals = document.querySelectorAll(
        'iframe[src*="pay" i], iframe[src*="card" i], iframe[src*="adyen" i], ' +
        'iframe[src*="stripe" i], iframe[src*="braintree" i], iframe[name*="card" i]'
      );
      const hasAddToCart = !!document.querySelector(
        'button[class*="add-to-cart" i], button[name*="add" i], ' +
        'input[value*="add to cart" i], button[data-action*="add-to-cart" i], ' +
        'form[action*="cart"] button[type="submit"], ' +
        'button[data-testid*="add" i], button[id*="add-to-cart" i], ' +
        'button[aria-label*="add to cart" i], button[aria-label*="add to bag" i], ' +
        'button[data-testid*="add-to-cart" i], [data-action="add-to-cart"], ' +
        'form[action*="/cart/add"] button, ' +
        'button[data-test*="add-to-cart" i], button[data-test*="addToCart" i], ' +
        '[data-test="shipItButton"], [data-test="orderPickupButton"]'
      );
      const addToCartText = ["add to cart", "add to bag", "add to basket", "buy now", "add it to your cart", "add item", "add to order", "ship it", "pick it up", "deliver it"];
      const hasAtcText = addToCartText.some(s => text.includes(s));
      const isCheckoutUrl = url.includes("/checkout") || url.includes("/payment") ||
        url.includes("/billing");

      // Product page — check BEFORE payment to avoid misclassifying product pages
      // that have Shop Pay / express checkout card inputs.
      // Product pages have ATC buttons and are NOT on checkout URLs.
      if ((hasAddToCart || hasAtcText) && !isCheckoutUrl) {
        return "product" as const;
      }

      // Payment form (card fields visible on main page)
      if (hasCardFields) {
        return "payment-form" as const;
      }

      // Login-gate — URL-based early detection (before payment-gateway steals it)
      const isLoginUrl2 = isCheckoutUrl && (
        url.includes("/sign-in") || url.includes("/signin") || url.includes("/login")
      );
      if (isLoginUrl2) {
        return "login-gate" as const;
      }

      // Payment gateway (iframes that likely contain card fields)
      if (paymentIframeSignals.length > 0) {
        return "payment-gateway" as const;
      }

      // Shipping form — broadened detection
      const shippingSelectors = [
        'input[autocomplete="given-name"]', 'input[autocomplete="address-line1"]',
        'input[name*="firstName" i]', 'input[name*="address1" i]',
        'input[autocomplete="shipping"]', 'input[autocomplete="name"]',
        'input[name*="fullName" i]', 'input[name*="full_name" i]',
        'input[name*="line1" i]', 'input[name*="streetAddress" i]',
        'input[name*="first_name" i]',
      ];
      const shippingFieldCount = shippingSelectors.filter(sel =>
        document.querySelector(sel) !== null
      ).length;
      if (shippingFieldCount >= 2 || (isCheckoutUrl && shippingFieldCount >= 1)) {
        return "shipping-form" as const;
      }

      // Email verification / OTP page — check BEFORE email-only step
      const verificationSignals = [
        "verification code", "enter code", "enter the code",
        "we sent", "we've sent", "check your email",
        "confirm your email", "one-time", "otp",
      ];
      const verificationCount = verificationSignals.filter(s => text.includes(s)).length;
      const otpInputs = document.querySelectorAll(
        'input[autocomplete="one-time-code"], ' +
        'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], ' +
        'input[name*="token" i], input[id*="code" i], input[id*="otp" i], ' +
        'input[maxlength="1"], input[maxlength="4"], input[maxlength="5"], ' +
        'input[maxlength="6"], input[maxlength="7"], input[maxlength="8"]'
      );
      // Require both text signals AND short code inputs (avoid false positives)
      if (verificationCount >= 1 && otpInputs.length > 0) {
        return "email-verification" as const;
      }

      // Email-only step (common in Shopify) — treat as shipping-form
      // Only trigger on /checkout URLs (NOT /cart — cart pages often have email login fields)
      const emailOnlyInputs = document.querySelectorAll('input[type="email"], input[name*="email" i]');
      const totalFormInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])');
      if (
        emailOnlyInputs.length > 0 &&
        totalFormInputs.length <= 3 &&
        isCheckoutUrl &&
        !url.includes("/cart")
      ) {
        return "shipping-form" as const;
      }

      // Review order page (pre-confirmation, after payment)
      const reviewSignals = [
        "review your order", "review order", "order review",
        "review and pay", "confirm your order", "place your order",
      ];
      const reviewCount = reviewSignals.filter(s => text.includes(s)).length;
      if (reviewCount >= 1 && (isCheckoutUrl || url.includes("/review"))) {
        return "payment-form" as const; // treat as payment so we click submit
      }

      // Login gate
      const loginSignals = [
        "sign in", "log in", "create account", "guest checkout",
        "continue as guest", "checkout as guest", "sign-in", "email or mobile",
        "sign up", "register", "returning customer", "new customer",
        "have an account", "already a member", "shop as guest",
      ];
      const loginCount = loginSignals.filter(s => text.includes(s)).length;
      const isLoginUrl = isCheckoutUrl || url.includes("/login") ||
        url.includes("/signin") || url.includes("/sign-in") || url.includes("/ap/signin");
      if (loginCount >= 2 && isLoginUrl) {
        return "login-gate" as const;
      }
      // Also detect as login-gate if URL is clearly a sign-in page
      if (isLoginUrl && loginCount >= 1) {
        return "login-gate" as const;
      }

      // Cart page
      const cartSignals = ["your cart", "shopping cart", "cart total", "order summary"];
      const cartCount = cartSignals.filter(s => text.includes(s)).length;
      const hasCheckoutButton = !!document.querySelector(
        'a[href*="checkout" i], button[class*="checkout" i], input[value*="checkout" i]'
      );
      if (cartCount >= 1 && hasCheckoutButton) {
        return "cart" as const;
      }
      if (url.includes("/cart")) {
        return "cart" as const;
      }

      // Product page fallback (for pages on checkout URLs that also have ATC)
      if (hasAddToCart || hasAtcText) {
        return "product" as const;
      }

      // Error page — checked LAST so product/payment/shipping pages aren't misclassified
      // (e.g., Stripe demo mentions "payment failed" in description but is a product page)
      const errorTextSignals = [
        // Payment declines
        "card was declined", "card has been declined", "payment was declined",
        "payment declined", "transaction was declined", "transaction declined",
        "your card was denied", "payment was not successful",
        "unable to process your payment", "could not process your payment",
        "payment could not be completed", "we couldn't process your payment",
        // Card validation
        "invalid card number", "card number is invalid", "card has expired",
        "incorrect cvc", "incorrect cvv", "security code is incorrect",
        "card was not accepted", "card is not supported",
        // Order-level errors
        "order could not be placed", "order could not be completed",
        "unable to place your order", "unable to complete your order",
        "we were unable to process", "there was a problem with your order",
        // Out of stock
        "sold out", "out of stock", "no longer available", "item is unavailable",
        "option not available", "currently unavailable",
        // Generic checkout errors
        "something went wrong", "an error occurred", "please try again",
        "transaction failed", "payment failed", "purchase failed",
        "insufficient funds", "do not honor",
      ];
      const errorTextCount = errorTextSignals.filter(s => text.includes(s)).length;

      // CSS-based error detection — visible elements with error-confirming text
      const errorCssSelectors = [
        '[role="alert"]', '[class*="error" i]', '[class*="decline" i]',
        '[class*="alert-danger" i]', '[class*="alert-error" i]',
        '[class*="payment-error" i]', '[class*="form-error" i]',
        '[data-testid*="error" i]', '[id*="error-message" i]',
      ];
      const errorConfirmingPhrases = [
        "declined", "failed", "invalid", "expired", "denied",
        "unable to", "could not", "cannot", "error", "problem",
        "sold out", "out of stock", "unavailable", "insufficient",
      ];
      let cssErrorCount = 0;
      for (const sel of errorCssSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const htmlEl = el as HTMLElement;
          // Must be visible
          const style = getComputedStyle(htmlEl);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (htmlEl.offsetParent === null && style.position !== "fixed" && style.position !== "sticky") continue;
          // Must contain error-confirming text
          const elText = (htmlEl.textContent || "").toLowerCase();
          if (errorConfirmingPhrases.some(p => elText.includes(p))) {
            cssErrorCount++;
          }
        }
      }

      // Trigger error if ≥1 text signal OR ≥2 CSS error elements
      if (errorTextCount >= 1 || cssErrorCount >= 2) {
        return "error" as const;
      }

      return "unknown" as const;
  };

  try {
    return await page.evaluate(evalBody, { cardSelectors: [...CARD_SELECTORS] });
  } catch {
    // DOM may be mutating (SPA navigation, hydration). Wait and retry once.
    await page.waitForTimeout(2000);
    try {
      return await page.evaluate(evalBody, { cardSelectors: [...CARD_SELECTORS] });
    } catch {
      return "unknown";
    }
  }
}

// ---- Extract confirmation data ----

export interface ConfirmationData {
  orderNumber?: string;
  total?: string;
}

export async function extractConfirmationData(page: Page): Promise<ConfirmationData> {
  return page.evaluate(() => {
    const text = document.body.textContent || "";

    // Order number patterns
    const orderPatterns = [
      /order\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /confirmation\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /reference\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
    ];
    let orderNumber: string | undefined;
    for (const pat of orderPatterns) {
      const m = text.match(pat);
      if (m?.[1]) { orderNumber = m[1]; break; }
    }

    // Total extraction
    const totalPatterns = [
      /(?:order\s*)?total\s*[:.]?\s*\$?\s*([\d,]+\.?\d{0,2})/i,
      /(?:amount\s*)?charged\s*[:.]?\s*\$?\s*([\d,]+\.?\d{0,2})/i,
      /\$\s*([\d,]+\.\d{2})/,
    ];
    let total: string | undefined;
    for (const pat of totalPatterns) {
      const m = text.match(pat);
      if (m?.[1]) { total = m[1].replace(/,/g, ""); break; }
    }

    return { orderNumber, total };
  });
}

// ---- Extract visible total from page ----

export async function extractVisibleTotal(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    // Pass 1: DOM-aware — find elements with total labels, extract adjacent dollar amount
    const labelPatterns = [
      "order total", "estimated total", "total due", "amount due",
      "subtotal", "order subtotal", "donation amount",
    ];
    const allElements = Array.from(document.querySelectorAll("*"));
    for (const el of allElements) {
      if (el.children.length > 5) continue; // skip large containers
      const elText = (el.textContent || "").toLowerCase().trim();
      if (!labelPatterns.some(lp => elText.includes(lp))) continue;
      const combined = (el.textContent || "") + " " + (el.nextElementSibling?.textContent || "");
      const m = combined.match(/\$\s*([\d,]+\.\d{2})/);
      if (m?.[1]) return m[1].replace(/,/g, "");
    }

    // Pass 2: Regex on full text — labeled patterns only
    const text = document.body.textContent || "";
    const labeledPatterns = [
      /(?:order\s*)?total\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
      /(?:estimated\s*)?total\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
      /(?:amount\s*)?due\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
      /(?:donation\s*)?amount\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
    ];
    for (const pat of labeledPatterns) {
      const m = text.match(pat);
      if (m?.[1]) return m[1].replace(/,/g, "");
    }

    // Pass 3: Greedy fallback — last resort
    const fallback = text.match(/[$€£¥]\s*([\d,]+\.\d{2})/);
    if (fallback?.[1]) return fallback[1].replace(/,/g, "");

    return undefined;
  });
}

// ---- Error message extraction ----

export type ErrorType = "payment_declined" | "card_invalid" | "out_of_stock" | "checkout_error";

export interface ErrorData {
  type: ErrorType;
  message: string;
}

export async function extractErrorMessage(page: Page): Promise<ErrorData> {
  return page.evaluate(() => {
    const text = (document.body.textContent || "").toLowerCase();

    // Classify error type
    const declinePatterns = [
      "card was declined", "card has been declined", "payment was declined",
      "payment declined", "transaction was declined", "transaction declined",
      "your card was denied", "payment was not successful",
      "unable to process your payment", "could not process your payment",
      "payment could not be completed", "we couldn't process your payment",
      "transaction failed", "payment failed", "insufficient funds", "do not honor",
    ];
    const cardInvalidPatterns = [
      "invalid card number", "card number is invalid", "card has expired",
      "incorrect cvc", "incorrect cvv", "security code is incorrect",
      "card was not accepted", "card is not supported",
    ];
    const outOfStockPatterns = [
      "sold out", "out of stock", "no longer available", "item is unavailable",
    ];

    let type: "payment_declined" | "card_invalid" | "out_of_stock" | "checkout_error" = "checkout_error";
    if (declinePatterns.some(p => text.includes(p))) type = "payment_declined";
    else if (cardInvalidPatterns.some(p => text.includes(p))) type = "card_invalid";
    else if (outOfStockPatterns.some(p => text.includes(p))) type = "out_of_stock";

    // Extract visible error text from DOM containers
    const errorSelectors = [
      '[role="alert"]', '[class*="error" i]', '[class*="decline" i]',
      '[class*="alert-danger" i]', '[class*="alert-error" i]',
      '[class*="payment-error" i]', '[class*="form-error" i]',
      '[data-testid*="error" i]', '[id*="error-message" i]',
    ];
    const errorConfirming = [
      "declined", "failed", "invalid", "expired", "denied",
      "unable to", "could not", "cannot", "error", "problem",
      "sold out", "out of stock", "unavailable", "insufficient",
    ];

    for (const sel of errorSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const htmlEl = el as HTMLElement;
        const style = getComputedStyle(htmlEl);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (htmlEl.offsetParent === null && style.position !== "fixed" && style.position !== "sticky") continue;
        const elText = (htmlEl.textContent || "").trim();
        if (elText.length > 0 && elText.length < 500 && errorConfirming.some(p => elText.toLowerCase().includes(p))) {
          return { type, message: elText };
        }
      }
    }

    // Fallback: find matching error phrase in full page text
    const allPatterns = [...declinePatterns, ...cardInvalidPatterns, ...outOfStockPatterns,
      "something went wrong", "an error occurred", "please try again",
      "purchase failed", "order could not be placed", "order could not be completed",
      "unable to place your order", "unable to complete your order",
      "there was a problem with your order",
    ];
    for (const p of allPatterns) {
      if (text.includes(p)) {
        return { type, message: p };
      }
    }

    return { type, message: "Unknown checkout error" };
  });
}

// ---- Scripted verification code fill ----

export async function scriptedFillVerificationCode(
  page: Page,
  code: string,
): Promise<boolean> {
  return page.evaluate((c) => {
    function fillInput(el: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    // 1. Try autocomplete="one-time-code" first
    const otcInput = document.querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]'
    );
    if (otcInput) {
      fillInput(otcInput, c);
      return true;
    }

    // 2. Try named code/otp/verification inputs
    const namedSelectors = [
      'input[name*="code" i]', 'input[name*="otp" i]', 'input[name*="verification" i]',
      'input[name*="token" i]', 'input[id*="code" i]', 'input[id*="otp" i]',
    ];
    for (const sel of namedSelectors) {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el && el.type !== "hidden") {
        fillInput(el, c);
        return true;
      }
    }

    // 3. Split OTP inputs — multiple adjacent single-char inputs (maxlength=1)
    const splitInputs = document.querySelectorAll<HTMLInputElement>(
      'input[maxlength="1"]'
    );
    if (splitInputs.length >= 4 && splitInputs.length <= 8 && c.length === splitInputs.length) {
      for (let i = 0; i < splitInputs.length; i++) {
        fillInput(splitInputs[i]!, c[i]!);
      }
      return true;
    }

    // 4. Short maxlength inputs (4-8 chars)
    for (let len = 4; len <= 8; len++) {
      const el = document.querySelector<HTMLInputElement>(
        `input[maxlength="${len}"]`
      );
      if (el && el.type !== "hidden") {
        fillInput(el, c);
        return true;
      }
    }

    return false;
  }, code);
}
