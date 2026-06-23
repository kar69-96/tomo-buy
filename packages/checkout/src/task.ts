import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";
import type { Order, ShippingInfo } from "@bloon/core";
import {
  buildCredentials,
  getStagehandVariables,
  getCdpCredentials,
} from "./credentials.js";
import { verifyConfirmationPage } from "./confirm.js";
import {
  extractDomain,
  loadDomainCache,
  saveDomainCache,
  extractDomainCache,
  injectDomainCache,
  injectLocalStorage,
} from "./cache.js";
import { createSession, destroySession, getModelApiKey } from "./session.js";
import type { SessionOptions } from "./session.js";
import {
  scriptedDismissPopups,
  scriptedFillShipping,
  scriptedFillCardFields,
  scriptedFillBilling,
  scriptedUncheckBillingSameAsShipping,
  scriptedClickButton,
  scriptedSelectOption,
  scriptedFillVerificationCode,
  detectPageType,
  extractConfirmationData,
  extractVisibleTotal,
  extractErrorMessage,
} from "./scripted-actions.js";
import type { PageType } from "./scripted-actions.js";
import { getOrCreateInbox, getAgentEmail, pollForVerificationCode } from "./agentmail.js";

// ---- Checkout steps ----

export const CHECKOUT_STEPS = {
  NAVIGATE: "navigate",
  ADD_TO_CART: "add-to-cart",
  PROCEED_TO_CHECKOUT: "proceed-to-checkout",
  DISMISS_POPUPS: "dismiss-popups",
  FILL_SHIPPING: "fill-shipping",
  SELECT_SHIPPING: "select-shipping",
  AVOID_EXPRESS_PAY: "avoid-express-pay",
  OBSERVE_CARD_FIELDS: "observe-card-fields",
  FILL_CARD: "fill-card",
  FILL_BILLING: "fill-billing",
  VERIFY_EMAIL: "verify-email",
  VERIFY_PRICE: "verify-price",
  PLACE_ORDER: "place-order",
  VERIFY_CONFIRMATION: "verify-confirmation",
  CHECKOUT_ERROR: "checkout-error",
} as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[keyof typeof CHECKOUT_STEPS];

// ---- Types ----

export interface CheckoutCheckpoints {
  cart?: string;
  shipping?: string;
  payment?: string;
  confirmation?: string;
}

export interface CheckoutResult {
  success: boolean;
  orderNumber?: string;
  finalTotal?: string;
  sessionId: string;
  replayUrl: string;
  failedStep?: CheckoutStep;
  errorMessage?: string;
  errorCategory?: import("@bloon/core").CheckoutErrorCategory;
  diagnosticScreenshotPath?: string;
  checkpoints?: CheckoutCheckpoints;
  durationMs?: number;
}

export interface CheckoutInput {
  order: Order;
  shipping: ShippingInfo;
  selections?: Record<string, string>;
  dryRun?: boolean;
  sessionOptions?: SessionOptions;
}

// ---- Error classification ----

type CheckoutPhase =
  | "cart"
  | "shipping"
  | "delivery"
  | "payment"
  | "review"
  | "confirmation"
  | "unknown";

/**
 * Classify a checkout error into a CheckoutErrorCategory based on
 * the error message and visible page text.
 *
 * Priority: bot_detected > captcha_unsolved > payment_rejected >
 *           navigation_failed > form_fill_failed > session_timeout > unknown
 */
export function classifyError(
  errorMessage: string,
  pageText: string,
): import("@bloon/core").CheckoutErrorCategory {
  const msg = errorMessage.toLowerCase();
  const text = pageText.toLowerCase();

  // Bot detection (highest priority)
  if (
    msg.includes("access denied") ||
    msg.includes("automated browser") ||
    msg.includes("bot detected") ||
    text.includes("access denied") ||
    text.includes("automated access")
  ) {
    return "bot_detected";
  }

  // CAPTCHA unsolved
  if (
    msg.includes("captcha") ||
    msg.includes("challenge not resolved") ||
    msg.includes("challenge timeout")
  ) {
    return "captcha_unsolved";
  }

  // Payment rejection
  if (
    msg.includes("card declined") ||
    msg.includes("payment declined") ||
    text.includes("card was declined") ||
    text.includes("payment could not be processed") ||
    text.includes("payment declined")
  ) {
    return "payment_rejected";
  }

  // Navigation failures
  if (
    msg.includes("navigation timeout") ||
    msg.includes("net::err_") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("timeout exceeded")
  ) {
    return "navigation_failed";
  }

  // Form fill failures
  if (
    msg.includes("no card fields") ||
    msg.includes("no shipping fields") ||
    msg.includes("failed to fill") ||
    msg.includes("field not found")
  ) {
    return "form_fill_failed";
  }

  // Session timeout
  if (
    msg.includes("session expired") ||
    msg.includes("session timeout") ||
    msg.includes("max steps exceeded") ||
    msg.includes("max pages exceeded")
  ) {
    return "session_timeout";
  }

  return "unknown";
}

/**
 * Detect which checkout phase a URL corresponds to.
 * Uses URL path keywords and the presence of card fields.
 */
export function detectCheckoutPhase(
  url: string,
  hasCardFields: boolean,
): CheckoutPhase {
  const lower = url.toLowerCase();
  const path = (() => {
    try {
      return new URL(lower).pathname;
    } catch {
      return lower;
    }
  })();

  // Confirmation / thank-you (check first)
  if (
    path.includes("/confirmation") ||
    path.includes("/thank-you") ||
    path.includes("/thank_you") ||
    path.includes("/order-complete")
  ) {
    return "confirmation";
  }

  // Review / order-review
  if (
    path.includes("/review") ||
    path.includes("/order-review")
  ) {
    return "review";
  }

  // Payment / billing (from URL)
  if (
    path.includes("/payment") ||
    path.includes("/billing") ||
    path.includes("/pay")
  ) {
    return "payment";
  }

  // Card fields present → payment regardless of URL
  if (hasCardFields) {
    return "payment";
  }

  // Delivery / shipping method
  if (
    path.includes("/delivery") ||
    path.includes("/shipping-method") ||
    path.includes("/shipping_method") ||
    path.includes("/shipping-rate")
  ) {
    return "delivery";
  }

  // Cart / bag
  if (
    path.includes("/cart") ||
    path.includes("/bag") ||
    path.includes("/basket")
  ) {
    return "cart";
  }

  // Checkout / checkouts (default to shipping stage)
  if (
    path.includes("/checkout") ||
    path.includes("/checkouts")
  ) {
    return "shipping";
  }

  return "unknown";
}

/**
 * Check if a URL belongs to a Shopify checkout/store.
 */
export function isShopifyCheckout(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("myshopify.com") ||
    lower.includes("/checkouts/")
  );
}

// ---- Price tolerance ----

function isPriceAcceptable(expected: string, actual: string): boolean {
  const exp = parseFloat(expected);
  const act = parseFloat(actual);
  if (isNaN(exp) || isNaN(act)) return true; // can't verify, proceed
  if (exp === 0) return true; // dry-run / no expected price
  const diff = Math.abs(act - exp);
  return diff <= 1 || diff / exp <= 0.05;
}

// ---- Max pages & LLM budget ----

const MAX_PAGES = 20;
const MAX_LLM_CALLS = 25;

// ---- Page loop state ----

interface LoopState {
  currentStep: CheckoutStep;
  addedToCart: boolean;
  shippingFilled: boolean;
  cardFilled: boolean;
  billingFilled: boolean;
  selectionsApplied: boolean;
  llmCalls: number;
  pagesVisited: number;
  lastUrl: string;
  lastPageType: PageType | null;
  stallCount: number;
  verificationCode?: string;
  confirmationData?: { orderNumber?: string; total?: string };
}

// ---- Map page type → checkout step for reporting ----

function pageTypeToStep(pageType: PageType): CheckoutStep {
  switch (pageType) {
    case "donation-landing":
    case "product":
      return "add-to-cart";
    case "cart":
      return "proceed-to-checkout";
    case "login-gate":
      return "proceed-to-checkout";
    case "email-verification":
      return "verify-email";
    case "shipping-form":
      return "fill-shipping";
    case "payment-form":
    case "payment-gateway":
      return "fill-card";
    case "confirmation":
      return "verify-confirmation";
    case "error":
      return "checkout-error";
    default:
      return "navigate";
  }
}

// ---- Build contextual LLM fallback instruction ----

function buildPageInstruction(
  pageType: PageType,
  input: CheckoutInput,
  state: LoopState,
  isStalled = false,
): string {
  const price = input.order.product.price;
  const dryRun = input.dryRun;
  const selections = input.selections;
  const domain = extractDomain(input.order.product.url);

  // Context prefix for the LLM
  const done: string[] = [];
  if (state.shippingFilled) done.push("shipping filled");
  if (state.cardFilled) done.push("card filled");
  if (state.billingFilled) done.push("billing filled");
  const ctx = done.length > 0
    ? `[${domain}] Already done: ${done.join(", ")}. `
    : `[${domain}] `;
  const stallHint = isStalled
    ? "Previous action didn't advance the page. Try a different approach — scroll down, look for alternative buttons, or try clicking directly. "
    : "";

  switch (pageType) {
    case "donation-landing":
      if (isStalled) {
        return `${ctx}${stallHint}Do NOT click the payment method button yet. First find and click the donation amount closest to $${price}. Look for radio buttons, amount cards, or clickable elements showing dollar amounts. After selecting the amount, select "one-time" if available, then click "Continue", "Donate", or "Give now".`;
      }
      return `${ctx}First select the $${price} donation amount — look for radio buttons, amount cards, or clickable dollar amounts. Then select one-time (not recurring). Then click "Continue", "Donate by card", "Donate", or "Give now" to proceed to payment. Do NOT click the payment method button before selecting the amount.`;

    case "product": {
      // Buy endpoint: selections come from the order (set at query time).
      // Checkout should ONLY apply known selections, never explore/discover variants.

      // Item already in cart — navigate to checkout
      if (state.addedToCart) {
        return `${ctx}${stallHint}The item is already in the cart. Click the "Checkout" button to proceed. If you see a cart drawer/sidebar, click "Checkout" inside it. Do NOT click "Add to Cart" again.`;
      }

      if (selections && Object.keys(selections).length > 0) {
        if (state.selectionsApplied) {
          // Selections applied — click Add to Cart
          return `${ctx}${stallHint}Product options are already selected. Click the "Add to Cart", "Add to Bag", or "Buy Now" button NOW. Do NOT re-select any options.`;
        }
        // First attempt: select options
        return `${ctx}Select exactly these options: ${Object.entries(selections).map(([k, v]) => `${k}: ${v}`).join(", ")}. After selecting, click "Add to Cart" or "Add to Bag".`;
      }
      // No selections — just add to cart.
      return `${ctx}Click "Add to Cart", "Add to Bag", or "Buy Now". Do NOT browse or select any product options.`;
    }

    case "cart":
      return `${ctx}${stallHint}Click "Checkout", "Proceed to Checkout", or "Continue to Checkout" to advance to the checkout page.`;

    case "login-gate":
      return `${ctx}${stallHint}Click "Guest Checkout", "Continue as Guest", "Continue without account", "Checkout as Guest", "Continue without signing in", "Skip sign in", "Shop as guest", or "No thanks" to skip login. Do NOT create an account.`;

    case "email-verification":
      return `${ctx}${stallHint}Enter the verification code that was sent to the email address. The code is: ${state.verificationCode ?? "still being retrieved"}. If you see a code input field, enter it and click Verify/Submit/Continue.`;

    case "shipping-form": {
      if (!state.shippingFilled) {
        return `${ctx}${stallHint}Fill the shipping/contact form with: email=%x_shipping_email%, name=%x_shipping_name%, address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, phone=%x_shipping_phone%. Then click "Continue" or "Continue to payment".`;
      }
      return `${ctx}${stallHint}Shipping is already filled. Click "Continue", "Continue to payment", "Next", or "Save and continue" to proceed.`;
    }

    case "payment-form":
    case "payment-gateway":
      if (state.cardFilled) {
        return dryRun
          ? `${ctx}${stallHint}Payment fields are already filled. Find the order total and report it. Do NOT click Place Order.`
          : `${ctx}${stallHint}Payment fields are already filled. Click "Place Order", "Complete Purchase", "Submit Order", "Pay Now", or "Donate" to finalize.`;
      }
      return `${ctx}${stallHint}Fill the credit card payment fields, then ${dryRun ? "stop — do NOT place the order" : "click Place Order to finalize"}.`;

    case "confirmation":
      return `${ctx}Extract the order/confirmation number and final total from this confirmation page.`;

    default:
      if (state.addedToCart) {
        return `${ctx}${stallHint}Navigate to checkout. Look for a "Checkout" button (maybe inside a cart drawer), or click the cart icon and then "Checkout". Do NOT add items again.`;
      }
      return `${ctx}${stallHint}Navigate towards checkout completion. Look for checkout, cart, or payment links. Scroll down if needed.`;
  }
}

// ---- Full checkout orchestration ----

export async function runCheckout(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const { order, shipping } = input;
  const url = order.product.url;
  const domain = extractDomain(url);

  // 1. Build credentials
  const creds = buildCredentials(shipping);
  const stagehandVars = getStagehandVariables(creds);
  const cdpCreds = getCdpCredentials(creds);

  // 2. Prepare shipping data for scripted fill
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

  // 3. Billing data
  const billingData = {
    street: stagehandVars.x_billing_street ?? "",
    city: stagehandVars.x_billing_city ?? "",
    state: stagehandVars.x_billing_state ?? "",
    zip: stagehandVars.x_billing_zip ?? "",
    country: stagehandVars.x_billing_country ?? "",
  };

  // 3b. AgentMail — replace shipping email with agent inbox for verification support
  let agentInboxId: string | null = null;
  if (process.env.AGENTMAIL_API_KEY) {
    try {
      const inbox = await getOrCreateInbox();
      agentInboxId = inbox.inboxId;
      shippingData.email = inbox.email;
      stagehandVars.x_shipping_email = inbox.email;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [agentmail] init failed, using original email: ${msg.slice(0, 100)}`);
    }
  }

  // 4. Validate keys early (fail fast with clear error)
  const modelApiKey = getModelApiKey();

  // 5. Create Browserbase session
  const session = await createSession(input.sessionOptions);
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  const startMs = Date.now();

  try {
    // 6. Init Stagehand
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: modelApiKey,
      },
      browserbaseSessionID: session.id,
      experimental: true,
    });

    await stagehand.init();
    const page: Page = stagehand.context.activePage()!;

    // 7. Inject domain cache cookies (before navigation)
    const existingCache = loadDomainCache(domain);
    if (existingCache) {
      await injectDomainCache(page, existingCache);
    }

    // 8. Navigate to product URL
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeoutMs: 30000,
    });
    await page.waitForTimeout(5000);

    // 8a-verify. Redirect verification
    const finalUrl = page.url();
    try {
      const origDomain = extractDomain(url);
      const finalDomain = extractDomain(finalUrl);
      if (origDomain !== finalDomain) {
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `Redirect to different domain: ${origDomain} → ${finalDomain}`,
          durationMs: Date.now() - startMs,
        };
      }
      const finalUrlObj = new URL(finalUrl);
      const isSearchPage =
        ["/search", "/find"].some(s => finalUrlObj.pathname.toLowerCase().includes(s)) ||
        ["q=", "query="].some(s => finalUrlObj.search.toLowerCase().includes(s));
      if (isSearchPage) {
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `Product URL redirected to search page — product may no longer exist at original URL`,
          durationMs: Date.now() - startMs,
        };
      }
      if (finalUrl !== url) {
        console.log(`  [redirect] ${url.slice(0, 80)} → ${finalUrl.slice(0, 80)}`);
      }
    } catch { /* URL parsing failed — continue */ }

    // 8a-bot. Bot-block detection — minimal page content signals bot-blocked site
    try {
      const bodyText = await page.evaluate(() => document.body.textContent || "");
      const wordCount = bodyText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      const charCount = bodyText.trim().length;
      if (charCount < 500 || wordCount < 50) {
        console.log(`  [bot-blocked] page content too small: ${charCount} chars, ${wordCount} words`);
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `bot_blocked: page rendered minimal content (${charCount} chars, ${wordCount} words) — site likely blocks automated browsers`,
          durationMs: Date.now() - startMs,
        };
      }
    } catch {
      // Page evaluation failed — continue; we'll discover issues in the loop
    }

    // 8b. Inject localStorage (must happen after navigating to target domain)
    if (existingCache) {
      try {
        await injectLocalStorage(page, existingCache);
      } catch {
        // localStorage injection is best-effort
      }
    }

    // 8c. DOM pruning — strip non-functional elements to reduce token count
    await page.evaluate(() => {
      document.querySelectorAll("noscript").forEach(e => e.remove());
      document.querySelectorAll('[aria-hidden="true"]').forEach(e => e.remove());
      document.querySelectorAll("img").forEach(img => { img.removeAttribute("srcset"); });
    });

    // 8d. Initial scripted popup dismissal
    await scriptedDismissPopups(page);

    // 9. Page-based loop
    const state: LoopState = {
      currentStep: "navigate",
      addedToCart: false,
      shippingFilled: false,
      cardFilled: false,
      billingFilled: false,
      selectionsApplied: false,
      llmCalls: 0,
      pagesVisited: 0,
      lastUrl: page.url(),
      lastPageType: null,
      stallCount: 0,
      confirmationData: undefined,
    };

    for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      state.pagesVisited = pageIdx;

      // 9a. Wait for page to settle
      await page.waitForTimeout(2000);

      // 9b. Dismiss popups
      await scriptedDismissPopups(page);

      // 9c. Detect page type
      let pageType: PageType;
      try {
        pageType = await detectPageType(page);
      } catch {
        console.log(`  [detect-error] detectPageType threw, treating as unknown`);
        pageType = "unknown";
      }
      state.currentStep = pageTypeToStep(pageType);
      console.log(`[page ${pageIdx}] type=${pageType} url=${page.url().slice(0, 80)}`);

      // 9d. Run page-type handler (all scripted, 0 LLM)
      let advanced = false;

      switch (pageType) {
        case "donation-landing": {
          // 3-step scripted handler: select amount → one-time → click payment button
          console.log(`  [donation] entering scripted handler, price=${input.order.product.price}`);
          const price = input.order.product.price;
          let amountSelected = false;

          // Step 1: Select donation amount matching order price
          if (price) {
            const priceNum = parseFloat(price);
            const variants = [
              `$${priceNum}`, `$${priceNum.toFixed(2)}`, `${priceNum}`, `${priceNum.toFixed(2)}`,
            ];

            // Try radio buttons with matching value
            for (const v of variants) {
              if (await scriptedSelectOption(page, v, "radio")) {
                amountSelected = true;
                console.log(`  [donation] selected amount via radio: ${v}`);
                break;
              }
            }

            // Try data-amount or clickable elements containing price text
            if (!amountSelected) {
              amountSelected = await page.evaluate((vars: string[]) => {
                // data-amount attributes
                for (const v of vars) {
                  const plain = v.replace("$", "");
                  const el = document.querySelector(`[data-amount="${plain}"], [data-amount="${v}"]`);
                  if (el) { (el as HTMLElement).click(); return true; }
                }
                // Buttons/labels containing the price text
                const clickables = document.querySelectorAll(
                  'button, label, [role="button"], [class*="amount" i], [class*="option" i]',
                );
                for (const el of clickables) {
                  const text = (el.textContent || "").trim();
                  if (vars.some(v => text === v || text.includes(v))) {
                    (el as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              }, variants);
              if (amountSelected) console.log(`  [donation] selected amount via DOM click`);
            }
          }

          // Step 2: Select one-time (not recurring)
          if (amountSelected) {
            await page.waitForTimeout(500);
            const oneTimeSelected =
              await scriptedSelectOption(page, "one-time", "radio") ||
              await scriptedSelectOption(page, "one time", "radio") ||
              await scriptedSelectOption(page, "just once", "radio");
            if (oneTimeSelected) console.log(`  [donation] selected one-time frequency`);
          }

          // Step 3: Click payment button (only if amount was selected)
          if (amountSelected) {
            await page.waitForTimeout(500);
            advanced =
              await scriptedClickButton(page, "donate by credit") ||
              await scriptedClickButton(page, "donate by card") ||
              await scriptedClickButton(page, "credit card") ||
              await scriptedClickButton(page, "credit/debit card") ||
              await scriptedClickButton(page, "donate now") ||
              await scriptedClickButton(page, "continue") ||
              await scriptedClickButton(page, "donate") ||
              await scriptedClickButton(page, "give now");
            if (advanced) console.log(`  [donation] clicked payment button`);
          }

          // If amount selection failed → advanced stays false → LLM fallback
          if (!amountSelected && price) {
            console.log(`  [donation] scripted amount selection failed for $${price}`);
          }
          break;
        }

        case "product": {
          if (input.selections && Object.keys(input.selections).length > 0 && !state.selectionsApplied) {
            // Variant selection needed and not yet applied — defer to LLM
            // advanced stays false → LLM fallback handles selection
            break;
          }

          // If already added to cart, navigate to /checkout directly
          if (state.addedToCart) {
            console.log(`  [product] already in cart, navigating to /checkout`);
            try {
              const checkoutUrl = new URL(page.url());
              checkoutUrl.pathname = "/checkout";
              checkoutUrl.search = "";
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
            break;
          }

          // Check for out-of-stock / unavailable variant before trying ATC
          const isUnavailable = await page.evaluate(() => {
            const unavailableTexts = [
              "option not available", "sold out", "out of stock",
              "unavailable", "notify me", "coming soon", "not available",
              "currently out", "temporarily out",
            ];
            // Check all buttons and submit inputs for unavailable signals
            const allButtons = document.querySelectorAll('button, input[type="submit"]');
            for (const btn of allButtons) {
              const text = (btn.textContent || "").trim().toLowerCase();
              const value = ((btn as HTMLInputElement).value || "").toLowerCase();
              const combined = `${text} ${value}`;
              if (unavailableTexts.some(s => combined.includes(s))) {
                return text || value || "unavailable";
              }
            }
            return null;
          });
          if (isUnavailable) {
            console.log(`  [product] ATC button unavailable: "${isUnavailable}"`);
            return {
              success: false,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              failedStep: "add-to-cart" as CheckoutStep,
              errorMessage: `out_of_stock: ${isUnavailable}`,
              durationMs: Date.now() - startMs,
            };
          }

          // No selections needed, or selections already applied — try scripted add-to-cart
          // Prefer "buy now" (goes directly to checkout, skips cart drawer)
          const addedToCart =
            await scriptedClickButton(page, "buy now") ||
            await scriptedClickButton(page, "add to cart") ||
            await scriptedClickButton(page, "add to bag") ||
            await scriptedClickButton(page, "add to basket") ||
            await scriptedClickButton(page, "ship it") ||
            await scriptedClickButton(page, "deliver it");
          if (addedToCart) {
            state.addedToCart = true;
            console.log(`  [product] added to cart via scripted click`);
            // Wait for navigation or cart drawer to appear
            await page.waitForTimeout(3000);
            // Check if page already navigated (buy now can go direct to checkout)
            const postAtcUrl = page.url();
            if (postAtcUrl !== url) {
              advanced = true;
            } else {
              // Still on product page — try checkout buttons in cart drawer
              advanced =
                await scriptedClickButton(page, "checkout") ||
                await scriptedClickButton(page, "proceed to checkout") ||
                await scriptedClickButton(page, "go to checkout") ||
                await scriptedClickButton(page, "secure checkout") ||
                await scriptedClickButton(page, "view bag") ||
                await scriptedClickButton(page, "view cart");
              // If no checkout button found, navigate directly to /checkout
              if (!advanced) {
                console.log(`  [product] no checkout button in drawer, navigating to /checkout`);
                try {
                  const checkoutUrl = new URL(page.url());
                  checkoutUrl.pathname = "/checkout";
                  checkoutUrl.search = "";
                  await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
                  advanced = true;
                } catch {
                  // Fall through to LLM
                }
              }
            }
          }
          break;
        }

        case "cart": {
          advanced =
            await scriptedClickButton(page, "checkout") ||
            await scriptedClickButton(page, "proceed to checkout") ||
            await scriptedClickButton(page, "continue to checkout") ||
            await scriptedClickButton(page, "secure checkout") ||
            await scriptedClickButton(page, "go to checkout") ||
            await scriptedClickButton(page, "start checkout") ||
            await scriptedClickButton(page, "begin checkout");
          // Fallback: navigate directly to /checkout if buttons didn't work
          if (!advanced) {
            console.log(`  [cart] no checkout button found, navigating to /checkout`);
            try {
              const checkoutUrl = new URL(page.url());
              checkoutUrl.pathname = "/checkout";
              checkoutUrl.search = "";
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }
          break;
        }

        case "login-gate": {
          advanced =
            await scriptedClickButton(page, "guest checkout") ||
            await scriptedClickButton(page, "continue as guest") ||
            await scriptedClickButton(page, "continue without account") ||
            await scriptedClickButton(page, "guest") ||
            await scriptedClickButton(page, "checkout as guest") ||
            await scriptedClickButton(page, "continue without signing in") ||
            await scriptedClickButton(page, "skip sign in") ||
            await scriptedClickButton(page, "shop as guest") ||
            await scriptedClickButton(page, "checkout without an account") ||
            await scriptedClickButton(page, "no thanks");
          break;
        }

        case "email-verification": {
          // Poll AgentMail for verification code
          if (agentInboxId) {
            const pollStart = new Date().toISOString();
            const code = await pollForVerificationCode(agentInboxId, pollStart, 60_000);

            if (code) {
              state.verificationCode = code;
              const filled = await scriptedFillVerificationCode(page, code);
              if (filled) {
                console.log(`  [email-verification] filled code: ${code}`);
                await page.waitForTimeout(1000);
                advanced =
                  await scriptedClickButton(page, "verify") ||
                  await scriptedClickButton(page, "submit") ||
                  await scriptedClickButton(page, "continue") ||
                  await scriptedClickButton(page, "confirm");
              }
            } else {
              console.log("  [email-verification] timed out waiting for code");
            }
          } else {
            console.log("  [email-verification] no AgentMail inbox available");
          }
          break;
        }

        case "shipping-form": {
          const filled = await scriptedFillShipping(page, shippingData);
          state.shippingFilled = filled.length > 0;
          if (filled.length > 0) {
            console.log(`  [shipping] filled ${filled.length} fields: ${filled.join(", ")}`);
          }

          // If scripted fill got < 3 fields, supplement with LLM using variables
          if (filled.length < 3 && state.llmCalls < MAX_LLM_CALLS) {
            console.log(`  [shipping] only ${filled.length} fields via script, supplementing with LLM`);
            try {
              await stagehand.act(
                `Fill the shipping/contact form: email=%x_shipping_email%, name=%x_shipping_name%, address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, phone=%x_shipping_phone%. Skip any fields already filled.`,
                { variables: stagehandVars },
              );
              state.llmCalls++;
              state.shippingFilled = true;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.log(`  [shipping llm error] ${msg.slice(0, 100)}`);
              state.llmCalls++;
            }
          }

          if (state.shippingFilled || filled.length > 0) {
            await page.waitForTimeout(1000);
            advanced =
              await scriptedClickButton(page, "continue") ||
              await scriptedClickButton(page, "continue to payment") ||
              await scriptedClickButton(page, "next") ||
              await scriptedClickButton(page, "save and continue") ||
              await scriptedClickButton(page, "continue to shipping");
          }
          break;
        }

        case "payment-form":
        case "payment-gateway": {
          // Combined checkout pages (Glossier, etc.) show shipping + payment on same page.
          // Fill shipping first if not done yet.
          if (!state.shippingFilled) {
            const shippingFilled = await scriptedFillShipping(page, shippingData);
            state.shippingFilled = shippingFilled.length > 0;
            if (shippingFilled.length > 0) {
              console.log(`  [payment-page shipping] filled ${shippingFilled.length} fields: ${shippingFilled.join(", ")}`);
            }
            // Supplement with LLM if scripted got < 3 fields
            if (shippingFilled.length < 3 && state.llmCalls < MAX_LLM_CALLS) {
              console.log(`  [payment-page shipping] only ${shippingFilled.length} fields via script, supplementing with LLM`);
              try {
                await stagehand.act(
                  `Fill the shipping/contact form fields on this page: email=%x_shipping_email%, name=%x_shipping_name%, address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, phone=%x_shipping_phone%. Skip any fields already filled.`,
                  { variables: stagehandVars },
                );
                state.llmCalls++;
                state.shippingFilled = true;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  [payment-page shipping llm error] ${msg.slice(0, 100)}`);
                state.llmCalls++;
              }
            }
            // Click continue if there's a shipping-to-payment transition button
            await page.waitForTimeout(1000);
            await scriptedClickButton(page, "continue") ||
              await scriptedClickButton(page, "continue to payment") ||
              await scriptedClickButton(page, "next") ||
              await scriptedClickButton(page, "save and continue");
            await page.waitForTimeout(2000);
          }

          if (!state.cardFilled) {
            // Uncheck billing same as shipping
            await scriptedUncheckBillingSameAsShipping(page);
            await page.waitForTimeout(500);

            // Fill card fields
            const cardResult = await scriptedFillCardFields(page, cdpCreds);
            state.cardFilled = cardResult.filled > 0;
            console.log(`  [card] filled ${cardResult.filled} fields via ${cardResult.method}`);

            // Wait longer for form validation after card fill
            if (state.cardFilled) {
              await page.waitForTimeout(2000);
            }

            // Fill billing if available
            if (billingData.street) {
              const billingFilled = await scriptedFillBilling(page, billingData);
              state.billingFilled = billingFilled.length > 0;
              if (billingFilled.length > 0) {
                console.log(`  [billing] filled ${billingFilled.length} fields: ${billingFilled.join(", ")}`);
              }
            }
          }

          if (input.dryRun) {
            // Dry run: extract total and stop
            const total = await extractVisibleTotal(page);
            state.confirmationData = { total };
            console.log(`  [dry-run] total=${total ?? "(not found)"}`);
            advanced = true; // Signal completion
            // Return early for dry run — don't place order
            const durationMs = Date.now() - startMs;
            // Save domain cache before returning
            try {
              const newCache = await extractDomainCache(page, domain);
              saveDomainCache(newCache);
            } catch { /* best-effort */ }

            return {
              success: true,
              finalTotal: total,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              durationMs,
            };
          }

          // Live: click place order — try multiple common button labels
          advanced =
            await scriptedClickButton(page, "place order") ||
            await scriptedClickButton(page, "complete purchase") ||
            await scriptedClickButton(page, "submit order") ||
            await scriptedClickButton(page, "donate") ||
            await scriptedClickButton(page, "pay now") ||
            await scriptedClickButton(page, "complete order") ||
            await scriptedClickButton(page, "confirm order") ||
            await scriptedClickButton(page, "pay") ||
            await scriptedClickButton(page, "submit payment");

          // Post-submit: check for inline validation errors (async merchant responses)
          if (advanced) {
            await page.waitForTimeout(3000);
            const postSubmitType = await detectPageType(page);
            if (postSubmitType === "error") {
              const errorData = await extractErrorMessage(page);
              console.log(`  [post-submit error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

              try {
                const newCache = await extractDomainCache(page, domain);
                saveDomainCache(newCache);
              } catch { /* best-effort */ }

              return {
                success: false,
                sessionId: session.id,
                replayUrl: session.replayUrl,
                failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
                errorMessage: `${errorData.type}: ${errorData.message}`,
                durationMs: Date.now() - startMs,
              };
            }
          }
          break;
        }

        case "confirmation": {
          const data = await extractConfirmationData(page);
          state.confirmationData = data;
          state.currentStep = "verify-confirmation";
          console.log(`  [confirmation] order=${data.orderNumber ?? "?"} total=${data.total ?? "?"}`);

          // Save domain cache
          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: true,
            orderNumber: data.orderNumber,
            finalTotal: data.total,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            durationMs: Date.now() - startMs,
          };
        }

        case "error": {
          const errorData = await extractErrorMessage(page);
          console.log(`  [error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

          // Save domain cache before returning
          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
            errorMessage: `${errorData.type}: ${errorData.message}`,
            durationMs: Date.now() - startMs,
          };
        }

        default: {
          // unknown — check for help/FAQ page recovery before LLM fallback
          const currentUrl = page.url().toLowerCase();
          if (state.addedToCart && (
            currentUrl.includes("/help") ||
            currentUrl.includes("/faq") ||
            currentUrl.includes("/support") ||
            currentUrl.includes("/customer-service")
          )) {
            try {
              const origin = new URL(page.url()).origin;
              console.log(`  [recovery] help page detected, navigating to ${origin}/cart`);
              await page.goto(`${origin}/cart`, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }
          break;
        }
      }

      // 9e. Stall detection — track URL + page type to detect no-progress loops
      const currentUrl = page.url();
      if (currentUrl === state.lastUrl && pageType === state.lastPageType) {
        state.stallCount++;
        console.log(`  [stall] same url+page type ${state.stallCount} times`);
      } else {
        state.stallCount = 0;
      }
      state.lastUrl = currentUrl;
      state.lastPageType = pageType;

      // Break out if completely stuck on same page (5+ stalls = no progress possible)
      if (state.stallCount >= 5) {
        console.log(`  [stuck] 5+ stalls on ${pageType} — giving up`);
        break;
      }

      // 9f. Check if we reached confirmation or error after scripted actions
      if (advanced) {
        await page.waitForTimeout(2000);
        const postType = await detectPageType(page);
        if (postType === "confirmation") {
          const data = await extractConfirmationData(page);
          state.confirmationData = data;
          state.currentStep = "verify-confirmation";
          console.log(`  [post-action confirmation] order=${data.orderNumber ?? "?"} total=${data.total ?? "?"}`);

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: true,
            orderNumber: data.orderNumber,
            finalTotal: data.total,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            durationMs: Date.now() - startMs,
          };
        }
        if (postType === "error") {
          const errorData = await extractErrorMessage(page);
          console.log(`  [post-action error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
            errorMessage: `${errorData.type}: ${errorData.message}`,
            durationMs: Date.now() - startMs,
          };
        }
      }

      // 9g. LLM fallback — if scripted handler didn't advance, or stalled ≥2 times
      const needsLlm = !advanced || state.stallCount >= 2;
      if (needsLlm && state.llmCalls < MAX_LLM_CALLS) {
        const isStalled = state.stallCount >= 2;
        const instruction = buildPageInstruction(pageType, input, state, isStalled);

        // For shipping forms with no scripted fill, pass variables for LLM substitution
        const actOptions: { variables?: Record<string, string> } = {};
        if (pageType === "shipping-form" && !state.shippingFilled) {
          actOptions.variables = stagehandVars;
        }

        console.log(`  [llm fallback ${state.llmCalls + 1}/${MAX_LLM_CALLS}${isStalled ? " STALLED" : ""}] ${instruction.slice(0, 100)}...`);

        try {
          await stagehand.act(instruction, actOptions);
          state.llmCalls++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  [llm error] ${msg.slice(0, 100)}`);
          state.llmCalls++;
        }

        // After LLM on product page, mark selections as applied and try scripted ATC
        if (pageType === "product") {
          // Mark selections as applied after first LLM attempt
          if (input.selections && Object.keys(input.selections).length > 0) {
            state.selectionsApplied = true;
          }

          // Only try ATC if not already added
          if (!state.addedToCart) {
            await page.waitForTimeout(1000);
            const postLlmAtc =
              await scriptedClickButton(page, "buy now") ||
              await scriptedClickButton(page, "add to cart") ||
              await scriptedClickButton(page, "add to bag") ||
              await scriptedClickButton(page, "add to basket") ||
              await scriptedClickButton(page, "ship it") ||
              await scriptedClickButton(page, "deliver it");
            if (postLlmAtc) {
              state.addedToCart = true;
              console.log(`  [post-llm] scripted add-to-cart succeeded`);
              // Wait for navigation (buy now) or cart drawer
              await page.waitForTimeout(3000);
              // Try checkout buttons in cart drawer
              const wentToCheckout =
                await scriptedClickButton(page, "checkout") ||
                await scriptedClickButton(page, "proceed to checkout") ||
                await scriptedClickButton(page, "go to checkout") ||
                await scriptedClickButton(page, "view bag") ||
                await scriptedClickButton(page, "view cart");
              if (wentToCheckout) console.log(`  [post-llm] navigated to checkout via button`);
            }
          }
        }

        // Check for navigation / confirmation / error after LLM action
        // Wait longer when item is in cart (Shopify checkout redirects can take 5+ seconds)
        const postLlmWait = state.addedToCart ? 5000 : 2000;
        await page.waitForTimeout(postLlmWait);
        const postLlmType = await detectPageType(page);
        if (postLlmType === "confirmation") {
          const data = await extractConfirmationData(page);
          state.confirmationData = data;
          state.currentStep = "verify-confirmation";

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: true,
            orderNumber: data.orderNumber,
            finalTotal: data.total,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            durationMs: Date.now() - startMs,
          };
        }
        if (postLlmType === "error") {
          const errorData = await extractErrorMessage(page);
          console.log(`  [post-llm error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
            errorMessage: `${errorData.type}: ${errorData.message}`,
            durationMs: Date.now() - startMs,
          };
        }

        // Reset stall counter after LLM attempt if page changed
        if (page.url() !== currentUrl) {
          state.stallCount = 0;
        }
      } else if (needsLlm && state.llmCalls >= MAX_LLM_CALLS) {
        console.log(`  [budget exhausted] ${state.llmCalls}/${MAX_LLM_CALLS} LLM calls used`);
        break;
      }
    }

    // 10. Post-loop: check for confirmation via page text
    let confirmedViaPageText = false;
    let finalTotal: string | undefined;
    try {
      const bodyText = await page.evaluate(() => document.body.textContent || "");
      const confirmation = verifyConfirmationPage(bodyText);
      confirmedViaPageText = confirmation.isConfirmed;
      if (!finalTotal) {
        finalTotal = await extractVisibleTotal(page);
      }
    } catch {
      // Ignore page read errors
    }

    // 11. Price verification
    if (finalTotal && order.payment.price) {
      if (!isPriceAcceptable(order.payment.price, finalTotal)) {
        return {
          success: false,
          finalTotal,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: CHECKOUT_STEPS.VERIFY_PRICE as CheckoutStep,
          errorMessage: `Price mismatch: expected ~$${order.payment.price}, found $${finalTotal}`,
          durationMs: Date.now() - startMs,
        };
      }
    }

    // 12. Save domain cache
    try {
      const newCache = await extractDomainCache(page, domain);
      saveDomainCache(newCache);
    } catch {
      // Cache save is best-effort
    }

    // 13. Final result
    if (input.dryRun) {
      // Dry-run success requires reaching at least card fill stage
      // (or confirmation page). If we stalled on login-gate/cart/product,
      // the checkout didn't actually complete.
      const dryRunSuccess = state.cardFilled || confirmedViaPageText;
      return {
        success: dryRunSuccess,
        finalTotal: finalTotal ?? state.confirmationData?.total,
        sessionId: session.id,
        replayUrl: session.replayUrl,
        failedStep: dryRunSuccess ? undefined : state.currentStep,
        errorMessage: dryRunSuccess
          ? undefined
          : `Checkout did not reach payment stage (stopped at ${state.currentStep}, ${state.llmCalls}/${MAX_LLM_CALLS} LLM calls used)`,
        durationMs: Date.now() - startMs,
      };
    }

    return {
      success: confirmedViaPageText,
      orderNumber: state.confirmationData?.orderNumber,
      finalTotal: finalTotal ?? state.confirmationData?.total,
      sessionId: session.id,
      replayUrl: session.replayUrl,
      failedStep: confirmedViaPageText ? undefined : state.currentStep,
      errorMessage: confirmedViaPageText
        ? undefined
        : `Checkout did not reach confirmation page (stopped at ${state.currentStep}, ${state.llmCalls}/${MAX_LLM_CALLS} LLM calls used)`,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      success: false,
      sessionId: session.id,
      replayUrl: session.replayUrl,
      failedStep: "navigate" as CheckoutStep,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  } finally {
    // Destroy session
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        // Ignore close errors
      }
    }
    await destroySession(session.id);
  }
}
