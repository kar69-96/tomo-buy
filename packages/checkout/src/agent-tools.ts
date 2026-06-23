import type { Page } from "playwright";

// ---- Iframe card field scanner ----
//
// Fills card fields that live inside payment iframes (Stripe Elements, Shopify
// PCI, Adyen, Braintree, etc.). Card values are typed directly into the iframe
// inputs via Playwright — they never pass through the LLM.

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

  for (const meta of iframeMeta) {
    if (meta.src && meta.src !== "about:blank") {
      console.log(`  [iframe-scan] iframe[${meta.index}] name="${meta.name.slice(0, 50)}" id="${meta.id}" src="${meta.src.slice(0, 80)}"`);
    }
  }
  console.log(`  [iframe-scan] found ${iframeMeta.length} iframes (${iframeMeta.filter(m => m.src && m.src !== "about:blank").length} with src)`);

  // 2. Use page.frames() + frame.evaluate() for direct cross-origin iframe access.
  const allFrames = page.frames();
  console.log(`  [iframe-scan] page.frames() returned ${allFrames.length} frames`);

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

          // Fallback: focus + dispatch keyboard events inside the frame
          try {
            await matchedFrame.evaluate(
              ({ name, val }) => {
                const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
                if (!input) throw new Error(`input[name="${name}"] not found`);
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

  // 3. frameLocator fallback for any remaining unfilled fields
  if (filled === 0) {
    console.log(`  [iframe-scan] frame.locator approach failed, trying frameLocator...`);
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
          const loc = page.frameLocator(iframeSel).locator(selector.split(",")[0]!.trim()).first();
          await Promise.race([
            (async () => {
              await loc.click();
              await loc.type(value, { delay: 50 });
            })(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("frameLocator timeout")), 5000)),
          ]);
          filledFields.add(credKey);
          filled++;
          console.log(`  [iframe-scan] filled ${credKey} via frameLocator in ${meta.name.slice(0, 30)}`);
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
