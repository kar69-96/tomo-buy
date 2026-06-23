import { tool } from "@browserbasehq/stagehand";
import type { Stagehand, Page } from "@browserbasehq/stagehand";
import { z } from "zod";
import { fillAllCardFields } from "./fill.js";
import type { ObservedField } from "./fill.js";
import type { CostTracker } from "./cost-tracker.js";

// ---- Retry wrapper for Stagehand schema bugs ----

const MAX_ACT_RETRIES = 2;

export async function actWithRetry(
  stagehand: InstanceType<typeof Stagehand>,
  instruction: string,
  options?: { variables?: Record<string, string> },
  tracker?: CostTracker,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_ACT_RETRIES; attempt++) {
    try {
      const actStart = Date.now();
      await stagehand.act(instruction, options);
      if (tracker) {
        tracker.addLLMCall(
          `act/${instruction.slice(0, 30)}`,
          0, 0,
          "google/gemini-2.5-flash",
          Date.now() - actStart,
        );
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isSchemaError =
        msg.includes("AI_NoObjectGeneratedError") ||
        msg.includes("Invalid response schema") ||
        msg.includes("did not match the expected schema");
      if (isSchemaError && attempt < MAX_ACT_RETRIES) {
        continue;
      }
      throw err;
    }
  }
}

// ---- Iframe card field scanner ----

// Generic CSS selectors for card fields (used as fallback)
const CARD_FIELD_SELECTORS: Array<{ selector: string; credKey: string }> = [
  { selector: 'input[name*="cardnumber" i], input[name*="card-number" i], input[name*="encryptedCardNumber" i], input[autocomplete="cc-number"]', credKey: "x_card_number" },
  { selector: 'input[name*="exp" i], input[name*="encryptedExpiryDate" i], input[autocomplete="cc-exp"]', credKey: "x_card_expiry" },
  { selector: 'input[name*="cvc" i], input[name*="cvv" i], input[name*="encryptedSecurityCode" i], input[autocomplete="cc-csc"]', credKey: "x_card_cvv" },
  { selector: 'input[name*="holderName" i], input[name*="cardholder" i], input[autocomplete="cc-name"]', credKey: "x_cardholder_name" },
];

/**
 * Infer which card field type an iframe contains based on its name/src/id.
 * Stripe Elements puts each field (cardnumber, exp-date, cvc) in a separate named iframe.
 * Adyen, Braintree, etc. follow similar patterns.
 */
function inferCardFieldFromIframe(meta: { src: string; name: string; id: string; title: string }): string | null {
  const combined = `${meta.src} ${meta.name} ${meta.id} ${meta.title}`.toLowerCase();
  // Card number: "cardnumber", "card-number", "card-fields-number" (Shopify PCI)
  if (/cardnumber|card-number|card_number|cc-number|card-fields-number/.test(combined)) return "x_card_number";
  // Expiry: "exp-date", "expiry", "card-fields-expiry" (Shopify PCI)
  if (/exp-date|expiry|exp_date|cc-exp|expirydate|card-fields-expiry/.test(combined)) return "x_card_expiry";
  // CVV: "cvc", "cvv", "verification_value" (Shopify PCI), "security-code"
  if (/\bcvc\b|\bcvv\b|security-code|cc-csc|securitycode|verification_value/.test(combined)) return "x_card_cvv";
  // Cardholder name: "card-fields-name" (Shopify PCI), "holdername", "cardholder"
  if (/cardholder|holdername|cc-name|card-fields-name/.test(combined)) return "x_cardholder_name";
  return null;
}

export async function scanIframesForCardFields(
  page: Page,
  cdpCreds: Record<string, string>,
): Promise<{ filled: number }> {
  let filled = 0;
  const filledFields = new Set<string>();

  // 1. Get iframe metadata from the page
  const iframeMeta = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("iframe")).map((iframe, i) => ({
      index: i,
      src: iframe.src || "",
      name: iframe.name || "",
      id: iframe.id || "",
      title: iframe.title || "",
    }));
  });

  // Log all iframe details for debugging
  for (const meta of iframeMeta) {
    if (meta.src && meta.src !== "about:blank") {
      console.log(`  [iframe-scan] iframe[${meta.index}] name="${meta.name.slice(0, 50)}" id="${meta.id}" src="${meta.src.slice(0, 80)}"`);
    }
  }
  console.log(`  [iframe-scan] found ${iframeMeta.length} iframes (${iframeMeta.filter(m => m.src && m.src !== "about:blank").length} with src)`);

  // 2. Approach A: Use page.frames() + frame.evaluate() for direct CDP-backed access
  //    This bypasses Stagehand's selector resolution which can fail on cross-origin iframes.
  //    frame.evaluate() runs JS in the frame's context via CDP — works for cross-origin.
  const allFrames = page.frames();
  console.log(`  [iframe-scan] page.frames() returned ${allFrames.length} frames`);

  // Map iframe metadata (src) to frame handles
  for (const meta of iframeMeta) {
    if (!meta.src || meta.src === "about:blank") continue;
    const isPayment = /stripe|braintree|adyen|square|checkout\.com|spreedly|recurly|shopifyinc|shopify.*pci/i.test(meta.src);
    if (!isPayment) continue;
    // Skip non-card Stripe iframes (payment-request = Google/Apple Pay, iban, ideal-bank, etc.)
    if (/elements-inner-(?:payment-request|iban|ideal|universal-link|controller)/i.test(meta.src)) {
      console.log(`  [iframe-scan] skipping non-card Stripe iframe: ${meta.src.slice(0, 60)}`);
      continue;
    }

    // Find the matching frame handle
    let matchedFrame: (typeof allFrames)[0] | undefined;
    for (const frame of allFrames) {
      try {
        const frameUrl = await frame.evaluate(() => window.location.href);
        if (typeof frameUrl === "string" && frameUrl.includes(meta.src.split("?")[0]!.slice(0, 40))) {
          matchedFrame = frame;
          break;
        }
      } catch { /* can't evaluate — skip */ }
    }

    if (!matchedFrame) continue;

    // Diagnostic: list all inputs in this frame
    try {
      const inputInfo = await matchedFrame.evaluate(() => {
        const inputs = document.querySelectorAll("input");
        return Array.from(inputs).map(inp => ({
          name: inp.name,
          type: inp.type,
          autocomplete: inp.autocomplete,
          id: inp.id,
          placeholder: inp.placeholder,
        }));
      });
      if (inputInfo.length > 0) {
        console.log(`  [iframe-scan] frame "${meta.name.slice(0, 30)}" has ${inputInfo.length} inputs: ${inputInfo.map(i => i.name || i.id || i.type).join(", ")}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [iframe-scan] can't evaluate frame "${meta.name.slice(0, 30)}": ${msg.slice(0, 80)}`);
      continue;
    }

    // Stripe Card Element: combined card/exp/cvc in one iframe (src contains "elements-inner-card")
    if (/elements-inner-card/i.test(meta.src)) {
      console.log(`  [iframe-scan] found Stripe Card Element iframe: ${meta.name.slice(0, 40)}`);

      const stripeFields = [
        { inputName: "cardnumber", credKey: "x_card_number" },
        { inputName: "exp-date", credKey: "x_card_expiry" },
        { inputName: "cvc", credKey: "x_card_cvv" },
      ];

      for (const { inputName, credKey } of stripeFields) {
        if (filledFields.has(credKey)) continue;
        let value = cdpCreds[credKey];
        if (!value) continue;
        // Strip "/" from expiry — Stripe auto-formats digits
        if (credKey === "x_card_expiry") value = value.replace(/\//g, "");

        try {
          // Use frame.locator().type() which uses CDP Input domain (real keystrokes)
          const loc = matchedFrame.locator(`input[name="${inputName}"]`);
          await Promise.race([
            (async () => {
              await loc.click();
              await loc.type(value, { delay: 50 });
            })(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("type timeout")), 8000)),
          ]);
          filledFields.add(credKey);
          filled++;
          console.log(`  [iframe-scan] filled ${credKey} in Stripe Card Element`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  [iframe-scan] locator.type() failed for ${credKey}: ${msg.slice(0, 80)}`);

          // Fallback: use frame.evaluate() to focus + dispatch keyboard events
          // This works for inputs that reject CDP Input.insertText
          try {
            await matchedFrame.evaluate(
              ({ name, val }) => {
                const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
                if (!input) throw new Error(`input[name="${name}"] not found`);
                input.focus();
                input.click();
                // Clear any existing value
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                // Type each character with proper events
                for (const char of val) {
                  input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
                  input.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));
                  input.dispatchEvent(new InputEvent("input", { data: char, inputType: "insertText", bubbles: true }));
                  input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
                }
                input.dispatchEvent(new Event("change", { bubbles: true }));
              },
              { name: inputName, val: value },
            );
            filledFields.add(credKey);
            filled++;
            console.log(`  [iframe-scan] filled ${credKey} via frame.evaluate() fallback`);
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            console.log(`  [iframe-scan] frame.evaluate() also failed for ${credKey}: ${msg2.slice(0, 120)}`);
          }
        }
      }
      if (filled > 0) continue;
    }

    // Individual field iframes: one field per iframe (Shopify PCI, Stripe individual, Adyen, etc.)
    const credKey = inferCardFieldFromIframe(meta);
    if (credKey && !filledFields.has(credKey)) {
      let value = cdpCreds[credKey];
      if (value) {
        // Only strip "/" from expiry for Stripe iframes (Shopify may need it)
        const isStripe = /stripe/i.test(meta.src);
        if (credKey === "x_card_expiry" && isStripe) value = value.replace(/\//g, "");

        console.log(`  [iframe-scan] trying ${credKey} in individual iframe: ${meta.name.slice(0, 40)}`);

        try {
          const loc = matchedFrame.locator("input").first();
          await Promise.race([
            (async () => {
              await loc.click();
              await loc.type(value, { delay: 50 });
            })(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("type timeout")), 8000)),
          ]);
          filledFields.add(credKey);
          filled++;
          console.log(`  [iframe-scan] filled ${credKey} via individual payment iframe`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  [iframe-scan] locator.type() failed for ${credKey}: ${msg.slice(0, 80)}`);

          // Fallback: frame.evaluate() with keyboard event dispatch
          try {
            await matchedFrame.evaluate((val) => {
              const input = document.querySelector("input:not([type='hidden'])") as HTMLInputElement | null;
              if (!input) throw new Error("no visible input found");
              input.focus();
              input.click();
              input.value = "";
              input.dispatchEvent(new Event("input", { bubbles: true }));
              for (const char of val) {
                input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));
                input.dispatchEvent(new InputEvent("input", { data: char, inputType: "insertText", bubbles: true }));
                input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
              }
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }, value);
            filledFields.add(credKey);
            filled++;
            console.log(`  [iframe-scan] filled ${credKey} via frame.evaluate() fallback`);
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            console.log(`  [iframe-scan] frame.evaluate() also failed for ${credKey}: ${msg2.slice(0, 120)}`);
          }
        }
      }
    }

    // Generic: try CSS selectors in payment frames
    if (filled === 0) {
      for (const { selector, credKey: ck } of CARD_FIELD_SELECTORS) {
        if (filledFields.has(ck)) continue;
        const value = cdpCreds[ck];
        if (!value) continue;

        try {
          const loc = matchedFrame.locator(selector).first();
          await Promise.race([
            (async () => {
              await loc.click();
              await loc.type(value, { delay: 50 });
            })(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("generic timeout")), 5000)),
          ]);
          filledFields.add(ck);
          filled++;
          console.log(`  [iframe-scan] filled ${ck} (generic CSS) in ${meta.name.slice(0, 30)}`);
        } catch { /* skip */ }
      }
    }
  }

  // 3. Approach B: deepLocator fallback for any remaining unfilled fields
  if (filled === 0) {
    console.log(`  [iframe-scan] frame.locator approach failed, trying deepLocator...`);
    for (const meta of iframeMeta) {
      if (!meta.name || !meta.src || meta.src === "about:blank") continue;
      const isPayment = /stripe|braintree|adyen|square|checkout\.com|spreedly|recurly|shopifyinc|shopify.*pci/i.test(meta.src);
      if (!isPayment) continue;

      const iframeSel = `iframe[name="${meta.name}"]`;

      for (const { selector, credKey } of CARD_FIELD_SELECTORS) {
        if (filledFields.has(credKey)) continue;
        const value = cdpCreds[credKey];
        if (!value) continue;

        try {
          const deepLoc = page.deepLocator(`${iframeSel} >> ${selector.split(",")[0]!.trim()}`);
          await Promise.race([
            (async () => {
              await deepLoc.click();
              await deepLoc.type(value, { delay: 50 });
            })(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("deep timeout")), 5000)),
          ]);
          filledFields.add(credKey);
          filled++;
          console.log(`  [iframe-scan] filled ${credKey} via deepLocator in ${meta.name.slice(0, 30)}`);
        } catch { /* skip */ }
      }
    }
  }

  if (filled === 0) {
    console.log(`  [iframe-scan] no card fields found in any iframe`);
  } else {
    console.log(`  [iframe-scan] total: ${filled} card fields filled`);
  }

  return { filled };
}

// ---- Custom checkout tools factory ----

export function createCheckoutTools(
  stagehand: InstanceType<typeof Stagehand>,
  page: Page,
  stagehandVars: Record<string, string>,
  cdpCreds: Record<string, string>,
  costTracker?: CostTracker,
) {
  const fillShippingInfo = tool({
    description:
      "Fill all shipping and contact fields in the checkout form. " +
      "This fills email, name, street address, city, state, ZIP, country, and phone. " +
      "Call this ONCE when you reach the shipping/contact form.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const nameParts = (stagehandVars.x_shipping_name ?? "").split(" ");
        const shippingData = {
          email: stagehandVars.x_shipping_email ?? "",
          firstName: nameParts[0] ?? "",
          lastName: nameParts.slice(1).join(" ") || "",
          street: stagehandVars.x_shipping_street ?? "",
          apartment: stagehandVars.x_shipping_apartment ?? "",
          city: stagehandVars.x_shipping_city ?? "",
          state: stagehandVars.x_shipping_state ?? "",
          zip: stagehandVars.x_shipping_zip ?? "",
          country: stagehandVars.x_shipping_country ?? "",
          phone: stagehandVars.x_shipping_phone ?? "",
        };

        // Fill all fields via page.evaluate — instant, no LLM calls
        const filled = await page.evaluate((data) => {
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
              HTMLInputElement.prototype,
              "value",
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
            'input[autocomplete="email"]',
            'input[type="email"]',
            'input[name*="email" i]',
            'input[id*="email" i]',
          ]);
          if (email) {
            fillInput(email as HTMLInputElement, data.email);
            results.push("email");
          }

          // First name
          const fn = find([
            'input[autocomplete="given-name"]',
            'input[name*="firstName" i]',
            'input[name*="first_name" i]',
            'input[id*="firstName" i]',
          ]);
          if (fn) {
            fillInput(fn as HTMLInputElement, data.firstName);
            results.push("firstName");
          }

          // Last name
          const ln = find([
            'input[autocomplete="family-name"]',
            'input[name*="lastName" i]',
            'input[name*="last_name" i]',
            'input[id*="lastName" i]',
          ]);
          if (ln) {
            fillInput(ln as HTMLInputElement, data.lastName);
            results.push("lastName");
          }

          // Address
          const addr = find([
            'input[autocomplete="address-line1"]',
            'input[name*="address1" i]',
            'input[name*="street" i]',
            'input[id*="address1" i]',
          ]);
          if (addr) {
            fillInput(addr as HTMLInputElement, data.street);
            results.push("address");
          }

          // Apartment / Suite
          const apt = find([
            'input[autocomplete="address-line2"]',
            'input[name*="address2" i]',
            'input[name*="apartment" i]',
            'input[id*="address2" i]',
            'input[id*="apartment" i]',
          ]);
          if (apt && data.apartment) {
            fillInput(apt as HTMLInputElement, data.apartment);
            results.push("apartment");
          }

          // City
          const city = find([
            'input[autocomplete="address-level2"]',
            'input[name*="city" i]',
            'input[id*="city" i]',
          ]);
          if (city) {
            fillInput(city as HTMLInputElement, data.city);
            results.push("city");
          }

          // State (select dropdown)
          const state = find([
            'select[autocomplete="address-level1"]',
            'select[name*="zone" i]',
            'select[name*="state" i]',
            'select[name*="province" i]',
          ]);
          if (state) {
            if (fillSelect(state as HTMLSelectElement, data.state)) {
              results.push("state");
            }
          }

          // ZIP
          const zip = find([
            'input[autocomplete="postal-code"]',
            'input[name*="zip" i]',
            'input[name*="postal" i]',
            'input[id*="zip" i]',
          ]);
          if (zip) {
            fillInput(zip as HTMLInputElement, data.zip);
            results.push("zip");
          }

          // Phone
          const phone = find([
            'input[autocomplete="tel"]',
            'input[type="tel"]',
            'input[name*="phone" i]',
            'input[id*="phone" i]',
          ]);
          if (phone) {
            fillInput(phone as HTMLInputElement, data.phone);
            results.push("phone");
          }

          return results;
        }, shippingData);

        if (filled.length === 0) {
          return "No shipping/contact fields found on this page. Navigate to the form first.";
        }

        // Brief wait for any modals/popups triggered by form fill (e.g. login prompts, address autocomplete)
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
          // Click close/dismiss buttons on any dialog that isn't a CAPTCHA
          document.querySelectorAll(
            '[role="dialog"] button[aria-label*="close" i], ' +
            '[role="dialog"] button[aria-label*="dismiss" i]'
          ).forEach(btn => {
            const dialog = btn.closest('[role="dialog"]');
            const text = dialog?.textContent?.toLowerCase() || '';
            const isCaptcha = /captcha|recaptcha|hcaptcha|turnstile/i.test(text);
            if (!isCaptcha) (btn as HTMLElement).click();
          });
          // Press Escape to dismiss any remaining modal/autocomplete
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        return `Successfully filled ${filled.length} shipping fields (${filled.join(", ")}).`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to fill shipping fields: ${msg}`;
      }
    },
  });

  const fillCardFields = tool({
    description:
      "Fill credit card payment fields securely. " +
      "This finds card number, expiry, CVV, and cardholder name fields and fills them. " +
      "Call this ONCE when you are on the payment step and card fields are visible.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        // 1. Observe card fields via Stagehand (main page)
        const observeStart = Date.now();
        const observeResult = await stagehand.observe(
          "Find all credit card input fields on this page: card number, expiration date, CVV/security code, and cardholder name.",
        );
        if (costTracker) {
          costTracker.addLLMCall("observe/card-fields", 0, 0, "google/gemini-2.5-flash", Date.now() - observeStart);
        }

        let observedFields: ObservedField[] = observeResult.map((obs) => ({
          selector: obs.selector,
          description: obs.description,
        }));

        // 2. Iframe fallback — scan payment iframes for card fields
        //    Handles Adyen, Stripe, Braintree, etc. that embed card inputs in cross-origin iframes
        if (observedFields.length === 0) {
          const iframeFields = await scanIframesForCardFields(page, cdpCreds);
          if (iframeFields.filled > 0) {
            return `Successfully filled ${iframeFields.filled} card fields via payment iframe.`;
          }
          return "No card fields found on this page. The payment form may not be visible yet.";
        }

        // 3. Fill via CDP (card data NEVER enters LLM context)
        await fillAllCardFields(page, observedFields, cdpCreds);

        return "Successfully filled all card payment fields.";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to fill card fields: ${msg}`;
      }
    },
  });

  const fillBillingAddress = tool({
    description:
      "Uncheck 'billing same as shipping' and fill separate billing address fields. " +
      "Call this when you need to fill billing address — it will uncheck any 'same as shipping' checkbox first.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        // ALWAYS uncheck "billing same as shipping" first
        await page.evaluate(() => {
          const checkboxes = document.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]'
          );
          for (const cb of checkboxes) {
            const label = cb.labels?.[0]?.textContent?.toLowerCase() ?? '';
            const name = (cb.name + cb.id).toLowerCase();
            if (
              label.includes('same as shipping') ||
              label.includes('billing') ||
              name.includes('billing_same') ||
              name.includes('same_as_shipping')
            ) {
              if (cb.checked) {
                cb.click();
                cb.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
        });
        await page.waitForTimeout(500);

        // Then fill billing address fields
        await actWithRetry(
          stagehand,
          "Fill billing address: street=%x_billing_street%, city=%x_billing_city%, state=%x_billing_state%, zip=%x_billing_zip%, country=%x_billing_country%",
          { variables: stagehandVars },
          costTracker,
        );
        return "Unchecked billing=shipping and filled billing address fields.";
      } catch {
        return "Could not find or fill billing address fields.";
      }
    },
  });

  const clickButton = tool({
    description:
      "Click a button, link, or interactive element by its visible label or purpose. " +
      "Use this for all simple clicks: Add to Cart, Continue, Checkout, Close, Pay, etc. " +
      "Much faster than act(). Only use act() for complex multi-step interactions.",
    inputSchema: z.object({
      target: z.string().describe("What to click, e.g. 'Add to Cart', 'Checkout', 'Continue', 'Pay now'"),
    }),
    execute: async ({ target }) => {
      try {
        // Fast path: find button by text content (instant, no LLM)
        const clicked = await page.evaluate((t) => {
          const lower = t.toLowerCase();
          const candidates = document.querySelectorAll(
            'button, a[role="button"], input[type="submit"], [role="button"], a.btn, a.button, ' +
            'label[role="button"], div[role="button"], span[role="button"]'
          );
          for (const el of candidates) {
            const text = (el.textContent || "").trim().toLowerCase();
            const value = (el as HTMLInputElement).value?.toLowerCase() || "";
            const label = el.getAttribute("aria-label")?.toLowerCase() || "";
            if (text.includes(lower) || value.includes(lower) || label.includes(lower)) {
              // Check for inline onclick handler (e.g. onclick="someFunction(); return false;")
              const onclick = el.getAttribute("onclick");
              if (onclick) {
                // Execute the inline handler directly — some sites use onclick with return false
                // which prevents normal click() from triggering the handler correctly
                try {
                  new Function(onclick).call(el);
                  return true;
                } catch {
                  // Inline handler failed, fall through to regular click
                }
              }
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, target);

        if (clicked) {
          // Wait for potential page navigation or content load
          try {
            await page.waitForTimeout(3000);
          } catch {
            // Page may have navigated
          }
          return `Clicked "${target}".`;
        }

        // Slow path: use observe (LLM-based, handles complex selectors)
        const observeBtnStart = Date.now();
        const matches = await stagehand.observe(`Find the clickable element: ${target}`);
        if (costTracker) {
          costTracker.addLLMCall(`observe/click-${target.slice(0, 20)}`, 0, 0, "google/gemini-2.5-flash", Date.now() - observeBtnStart);
        }
        if (matches.length === 0) return `Could not find "${target}" on the page.`;
        await page.locator(matches[0].selector).click();
        await page.waitForTimeout(1500);
        return `Clicked "${target}".`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to click "${target}": ${msg}`;
      }
    },
  });

  const dismissPopups = tool({
    description:
      "Dismiss any visible popups, modals, or overlays on the page. " +
      "Clicks close/dismiss buttons and removes blocking overlays. " +
      "Does NOT dismiss CAPTCHAs (Browserbase auto-solves those). " +
      "Use this before interacting with the page if popups are blocking.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const dismissed = await page.evaluate(() => {
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
            if (!CAPTCHA_RE.test(dialog?.textContent || '')) {
              (btn as HTMLElement).click();
              actions.push("clicked close button");
            }
          });
          // Remove fixed overlays
          document.querySelectorAll('.overlay, .backdrop, [class*="overlay" i], [class*="backdrop" i]')
            .forEach(e => {
              if (!CAPTCHA_RE.test(e.textContent || '') && getComputedStyle(e).position === 'fixed') {
                e.remove();
                actions.push("removed overlay");
              }
            });
          // Press Escape
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          actions.push("pressed Escape");
          return actions;
        });
        return `Dismissed popups: ${dismissed.join(", ")}.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Popup dismissal attempted: ${msg}`;
      }
    },
  });

  return { fillShippingInfo, fillCardFields, fillBillingAddress, clickButton, dismissPopups };
}
