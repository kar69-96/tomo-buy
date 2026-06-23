import type { Page } from "@browserbasehq/stagehand";

// ---- Field observed by Stagehand ----

export interface ObservedField {
  selector: string;
  description: string;
  fieldName?: string;
}

// ---- Map Stagehand field descriptions to credential keys ----

const FIELD_PATTERNS: Array<{ pattern: RegExp; credentialKey: string }> = [
  { pattern: /card\s*number|credit\s*card/i, credentialKey: "x_card_number" },
  // Split expiry fields MUST come before general expiry (more specific match first)
  { pattern: /exp(iry)?\s*month/i, credentialKey: "x_card_exp_month" },
  { pattern: /exp(iry)?\s*year/i, credentialKey: "x_card_exp_year" },
  // General expiry (catches "Expiration date", "Expiry", "Exp date")
  { pattern: /expir|exp\s*date/i, credentialKey: "x_card_expiry" },
  { pattern: /cvv|cvc|security\s*code|verification/i, credentialKey: "x_card_cvv" },
  {
    pattern: /cardholder|name\s*on\s*card|card\s*name/i,
    credentialKey: "x_cardholder_name",
  },
];

export function mapFieldToCredential(description: string): string | null {
  for (const { pattern, credentialKey } of FIELD_PATTERNS) {
    if (pattern.test(description)) {
      return credentialKey;
    }
  }
  return null;
}

// ---- Fill a single card field via CDP ----

/**
 * Fills a single card field. Handles iframe-based selectors (e.g. Shopify's
 * PCI-compliant Stripe card inputs) by locating the iframe and filling
 * within its content frame.
 */
export async function fillCardField(
  page: Page,
  field: ObservedField,
  value: string,
): Promise<void> {
  const sel = field.selector;

  // Check if selector crosses an iframe boundary
  const iframeMatch = sel.match(/^(xpath=.+?\/iframe\[\d+\])\/(html.+)$/i);
  if (iframeMatch) {
    const iframeSel = iframeMatch[1]!;
    const innerPath = `xpath=/${iframeMatch[2]}`;

    // Use Playwright's FrameLocator API for cross-origin iframe access
    const input = page.frameLocator(iframeSel).locator(innerPath);
    await input.fill(value);
    return;
  }

  // Non-iframe selector — fill directly
  await page.locator(sel).fill(value);
}

// ---- Split expiry value into month/year ----

function splitExpiry(expiry: string): { month: string; year: string } {
  // Expected format: "MM/YY" or "MM/YYYY"
  const parts = expiry.split("/");
  const month = (parts[0] ?? "").trim();
  const rawYear = (parts[1] ?? "").trim();
  // Normalize 2-digit year to 4-digit
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return { month, year };
}

// ---- Fill all card fields from observed fields ----

export async function fillAllCardFields(
  page: Page,
  observedFields: ObservedField[],
  cdpCredentials: Record<string, string>,
): Promise<void> {
  // Build expanded credentials with split expiry for sites that use separate month/year fields
  const expiry = cdpCredentials.x_card_expiry ?? "";
  const { month, year } = splitExpiry(expiry);
  const expandedCreds: Record<string, string> = {
    ...cdpCredentials,
    x_card_exp_month: month,
    x_card_exp_year: year,
  };

  for (const field of observedFields) {
    const desc = field.fieldName || field.description;
    const credKey = mapFieldToCredential(desc);
    if (credKey && credKey in expandedCreds) {
      await fillCardField(page, field, expandedCreds[credKey]!);
    }
  }
}

// ---- Scan ALL frames (including nested OOPIFs) for card fields ----

const ENHANCED_CARD_SELECTORS: Array<{ selector: string; credKey: string }> = [
  {
    selector: [
      'input[name*="cardnumber" i]', 'input[name*="card-number" i]',
      'input[name*="encryptedCardNumber" i]', 'input[autocomplete="cc-number"]',
      'input[data-elements-stable-field-name="cardNumber"]',
      'input[aria-label*="card number" i]', 'input[placeholder*="card number" i]',
    ].join(", "),
    credKey: "x_card_number",
  },
  {
    selector: [
      'input[name*="exp" i]', 'input[name*="encryptedExpiryDate" i]',
      'input[autocomplete="cc-exp"]',
      'input[aria-label*="expir" i]', 'input[placeholder*="expir" i]',
    ].join(", "),
    credKey: "x_card_expiry",
  },
  {
    selector: [
      'input[name*="cvc" i]', 'input[name*="cvv" i]',
      'input[name*="encryptedSecurityCode" i]', 'input[autocomplete="cc-csc"]',
      'input[aria-label*="security code" i]', 'input[aria-label*="cvv" i]',
      'input[placeholder*="cvv" i]', 'input[placeholder*="cvc" i]',
    ].join(", "),
    credKey: "x_card_cvv",
  },
  {
    selector: [
      'input[name*="holderName" i]', 'input[name*="cardholder" i]',
      'input[autocomplete="cc-name"]',
      'input[aria-label*="cardholder" i]', 'input[aria-label*="name on card" i]',
    ].join(", "),
    credKey: "x_cardholder_name",
  },
];

export async function scanAllFramesForCardFields(
  page: Page,
  cdpCreds: Record<string, string>,
): Promise<{ filled: number }> {
  let filled = 0;

  // Enumerate ALL frames (including nested OOPIFs)
  const allFrames = page.frames();
  for (const frame of allFrames) {
    let frameFilled = 0;
    for (const { selector, credKey } of ENHANCED_CARD_SELECTORS) {
      const value = cdpCreds[credKey];
      if (!value) continue;

      try {
        const el = frame.locator(selector).first();
        await el.fill(value);
        frameFilled++;
      } catch {
        // Field not found in this frame — continue
      }
    }
    filled += frameFilled;

    // Only break if we found most card fields (3+) — some integrations
    // split fields across separate iframes (e.g., Adyen, Braintree)
    if (frameFilled >= 3) break;
  }

  return { filled };
}
