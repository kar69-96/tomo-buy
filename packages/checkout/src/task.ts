import type { Page } from "playwright";
import type { Order, ShippingInfo, ExecutionBrief } from "@tomo/core";
import { isFormFlowBrief } from "@tomo/core";
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
import { createSession, destroySession } from "./session.js";
import type { SessionOptions } from "./session.js";
import { playwrightAct } from "./act.js";
import {
  scriptedDismissPopups,
  scriptedFillShipping,
  scriptedFillCardFields,
  scriptedFillBilling,
  scriptedUncheckBillingSameAsShipping,
  scriptedClickButton,
  scriptedClickSelector,
  scriptedSelectOption,
  scriptedFillVerificationCode,
  detectPageType,
  extractConfirmationData,
  extractVisibleTotal,
  extractErrorMessage,
} from "./scripted-actions.js";
import type { PageType } from "./scripted-actions.js";
import { getOrCreateInbox, getAgentEmail, pollForVerificationCode } from "./agentmail.js";
import { executeLogin, seedSessionCookies } from "./login.js";
import type { LoginPlan } from "./login.js";
import { makeTracerFromEnv } from "./trace.js";
import type { TraceMode } from "./trace.js";
import { teeConsoleToFile } from "./log.js";
import type { ConsoleTee } from "./log.js";
import { SkillRecorder } from "./skill-recorder.js";
import {
  loadSiteSkill,
  writeSiteSkill,
  mergeSiteSkill,
  buildSelectorHints,
} from "./site-skill.js";
import { renderSkillMarkdown } from "./skill-renderer.js";
import { narrateLearnings } from "./skill-narrator.js";

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
  errorCategory?: import("@tomo/core").CheckoutErrorCategory;
  diagnosticScreenshotPath?: string;
  checkpoints?: CheckoutCheckpoints;
  durationMs?: number;
  /** True when a dry run reached the payment page and stopped before placing the order. */
  parkedAtPayment?: boolean;
}

export interface CheckoutInput {
  order: Order;
  shipping: ShippingInfo;
  selections?: Record<string, string>;
  dryRun?: boolean;
  sessionOptions?: SessionOptions;
  /** Single-use card to inject (Agentcard). Falls back to the .env card if omitted. */
  card?: import("@tomo/core").CardInfo;
  /**
   * Resolved login strategy + credentials for getting past a login gate. When
   * omitted (or strategy "guest"), the loop keeps its guest-checkout behavior.
   * Card-style trust boundary: any password/token here is filled directly, never
   * sent to the LLM.
   */
  loginPlan?: LoginPlan;
  /**
   * High-detail planner brief. For tasks the product page-type handlers don't
   * model (any multi-step form-driven checkout), the brief's objective, grounded
   * parameters and ordered execution_steps drive the LLM loop instead. No secrets.
   */
  brief?: ExecutionBrief;
}

/**
 * A brief-driven task is one the planner grounded as a structured, multi-step
 * objective (parameters to enter, an ordered plan to follow) rather than a
 * concrete product to add to a cart. Such tasks are driven by the brief + the
 * LLM, not the scripted product/cart page handlers. Generic across domains.
 */
function isBriefDrivenTask(input: CheckoutInput): boolean {
  return isFormFlowBrief(input.brief);
}

/**
 * Build a brief-driven instruction for the LLM on pages the scripted product
 * handlers don't model. Hands the executor the objective, grounded parameters,
 * the full ordered plan, and a hard stop before any irreversible payment.
 */
/**
 * True for a login plan that means "act as a signed-in user" (not guest). Covers
 * the user's own account AND an agent identity — used to fire the scripted login
 * opportunistically whenever a login form is actually on screen.
 */
function wantsAccountLogin(plan: LoginPlan | undefined): boolean {
  return (
    !!plan &&
    (plan.strategy === "connected_otp" ||
      plan.strategy === "connected_session" ||
      plan.strategy === "agent")
  );
}

/**
 * True only for the USER's own connected account, where signing in early unlocks
 * member pricing/benefits — so we proactively prompt opening the login link. An
 * agent identity logs in reactively (only when a gate blocks progress), so it is
 * deliberately excluded here: don't prompt a login the task doesn't need.
 */
function wantsProactiveLogin(plan: LoginPlan | undefined): boolean {
  return (
    !!plan &&
    (plan.strategy === "connected_otp" || plan.strategy === "connected_session")
  );
}

function buildBriefInstruction(
  brief: ExecutionBrief,
  dryRun: boolean | undefined,
  loginPlan?: LoginPlan,
): string {
  const params = Object.entries(brief.parameters ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const steps = (brief.execution_steps ?? [])
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
  const constraints = (brief.constraints ?? []).length
    ? `\nConstraints: ${brief.constraints.join("; ")}.`
    : "";
  const live = (brief.resolve_live ?? []).length
    ? `\nWhen you reach live choices (search results, available times/options), decide per: ${brief.resolve_live.join("; ")}.`
    : "";
  const stop = dryRun
    ? "Reach the payment page (where a credit-card number is requested), then STOP — do NOT enter card details or place/confirm the order."
    : "Stop just before placing/confirming the order for human review.";
  // When the task runs on the user's own account, sign in proactively (the email
  // + any one-time code are filled for you out-of-band — you only need to OPEN the
  // login page). Otherwise keep the guest-only default.
  const loginLine = wantsProactiveLogin(loginPlan)
    ? "ACCOUNT: this task runs on the user's own account. If a \"Log in\"/\"Sign in\" link is plainly visible (usually top-right), click it ONCE to open the login form — it is then completed automatically for you (do not type the email/password yourself, and do not retry). Do NOT let login block progress: completing the task is the priority — if login isn't readily available or doesn't complete, just continue."
    : "";
  const signInRule = wantsAccountLogin(loginPlan)
    ? "Sign in only via the existing-account \"Log in\"/\"Sign in\" flow; never CREATE a new account."
    : "Never create an account or sign in unless the page blocks all further progress without it.";
  return [
    `Objective: ${brief.objective}`,
    params ? `Parameters to use: ${params}.` : "",
    loginLine,
    "Do the NEXT step in this ordered plan that applies to the current page (skip steps already done):",
    steps,
    constraints,
    live,
    "How to act on this page:",
    "- FIRST, if any cookie banner, promo, newsletter, or modal overlay covers the page, close it (its ×, \"No thanks\", \"Continue\", or Escape) before anything else.",
    "- On a search or configuration form, set any OPTION TOGGLES/selectors to match the Parameters BEFORE filling text fields or submitting — these reshape the results and are easy to miss (e.g. a mode/type switch, a variant or category selector, quantity/count steppers). Pick the option the Parameters call for, NOT the default, and verify each toggle matches before submitting.",
    "- Complete EVERY field the current step needs before advancing. For an autocomplete/typeahead field, type the value then pick the suggestion that matches the requested name or code exactly (e.g. the entry whose code/identifier in parentheses matches). For a date, open the picker and navigate to the correct month/year, then click the day.",
    "- After the current section is complete, click the control that ADVANCES the page (Search, Continue, Next, Select, Proceed). Never leave a finished form unsubmitted.",
    "- On a results/options page, scroll to the individual selectable options and click a concrete PRICE or option button to choose one; a column header or a price shown as a placeholder (e.g. \"--\") is not selectable. If every option shows a placeholder price, the form's options/filters are wrong — go back and fix them.",
    `IMPORTANT: ${stop} ${signInRule}`,
  ]
    .filter(Boolean)
    .join("\n");
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
): import("@tomo/core").CheckoutErrorCategory {
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
  /** True once a connected/agent account login has been driven successfully. */
  loggedIn: boolean;
  /** How many times we've fired the scripted account login (capped). */
  loginAttempts: number;
  llmCalls: number;
  pagesVisited: number;
  lastUrl: string;
  lastPageType: PageType | null;
  /** Cheap DOM fingerprint (briefDriven flows) so same-URL form progress isn't a stall. */
  lastFingerprint: string;
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

// Generic (site-agnostic) guardrail against over-buying. Product pages often
// default to or highlight a multi-unit/bundle/subscription option (e.g. "2 Units
// — MOST POPULAR"), which the agent can mistake for the required variant. The
// task is to buy ONE unit, so the card is sized to a single item; picking a
// multi-pack inflates the total past the approved ceiling and declines.
const QTY_GUIDANCE =
  'Buy exactly ONE unit: keep the quantity at 1 and choose the single-unit ("1 unit") option. Do NOT select any multi-unit, multi-pack, bundle, or subscription/"subscribe & save" option, and do NOT increase the quantity stepper — even if another option is marked "most popular" or "best value".';

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

  // Brief-driven tasks: the scripted product handlers don't model an arbitrary
  // multi-step form flow, so drive those pages from the grounded brief instead.
  // Payment/confirmation/verification pages keep their specialized handling below.
  if (
    isBriefDrivenTask(input) &&
    input.brief &&
    pageType !== "payment-form" &&
    pageType !== "payment-gateway" &&
    pageType !== "confirmation" &&
    pageType !== "email-verification"
  ) {
    const stallHint = isStalled
      ? "The previous action didn't advance the page — try a different control (a different button, a dropdown option, or scroll to reveal it). "
      : "";
    return `[${domain}] ${stallHint}${buildBriefInstruction(input.brief, dryRun, input.loginPlan)}`;
  }

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
          return `${ctx}${stallHint}Product options are already selected. Click the "Add to Cart", "Add to Bag", or "Buy Now" button NOW. Do NOT re-select any options. ${QTY_GUIDANCE}`;
        }
        // First attempt: select options
        return `${ctx}Select exactly these options: ${Object.entries(selections).map(([k, v]) => `${k}: ${v}`).join(", ")}. After selecting, click "Add to Cart" or "Add to Bag". ${QTY_GUIDANCE}`;
      }
      // No pre-set selections — add to cart, but many products require a size/variant
      // before "Add to Cart" enables. Allow choosing the first in-stock option, while
      // discouraging unrelated browsing.
      return `${ctx}${stallHint}Add this item to the cart. If the "Add to Cart"/"Add to Bag" button is disabled or does nothing when clicked, a required option is unselected — pick the first available/in-stock size or variant, then click "Add to Cart", "Add to Bag", or "Buy Now". Keep the current color; do not navigate to other products. ${QTY_GUIDANCE}`;
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

/**
 * Persist the per-site checkout skill after a SUCCESSFUL, non-dry-run checkout.
 * Best-effort: any failure here must never fail an already-completed purchase.
 * Skips when no scripted selectors were captured (an all-LLM run teaches nothing).
 */
async function persistSkill(recorder: SkillRecorder, domain: string): Promise<void> {
  try {
    if (recorder.selectorCount === 0) return;
    const fresh = recorder.finalize();
    const merged = mergeSiteSkill(loadSiteSkill(domain), fresh);
    const learnings = await narrateLearnings(merged);
    const withProse = learnings ? { ...merged, learnings } : merged;
    writeSiteSkill(withProse, renderSkillMarkdown(withProse));
    console.log(
      `  [skill] wrote site-skills/${domain}/SKILL.md (${withProse.selectors.length} selectors, v${withProse.version})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [skill] write skipped: ${msg.slice(0, 100)}`);
  }
}

export async function runCheckout(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const { order, shipping } = input;
  const url = order.product.url;
  const domain = extractDomain(url);
  // Brief-driven tasks are not product/page-type driven. They legitimately navigate
  // to search/results URLs and skip the cart/add-to-cart handlers, so the product
  // guards (redirect-to-search, out-of-stock) must not abort them.
  const briefDriven = isBriefDrivenTask(input);
  // A multi-step task flow spans more distinct pages than a product checkout, and
  // every page is driven by an LLM step (no scripted handlers), so it needs a
  // larger page/LLM budget.
  const maxPages = briefDriven ? 32 : MAX_PAGES;
  const maxLlm = briefDriven ? 45 : MAX_LLM_CALLS;

  // 1. Build credentials (Agentcard card injected when provided)
  const creds = buildCredentials(shipping, input.card);
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

  // 4. Create the browser session. `domain` lets the Browserbase (ideal) runtime
  // attach a persistent per-domain Context; the local (debugging) runtime ignores
  // it and uses the file cache below.
  const session = await createSession({ ...input.sessionOptions, domain });
  const startMs = Date.now();

  // 4b. Optional deep tracer (JSONL + screenshots) — no-op unless CHECKOUT_TRACE_DIR set.
  const tracer = makeTracerFromEnv(session.id);
  // Mirror this run's console output to <trace>/run.log with elapsed timestamps,
  // so the full narrative is captured alongside the trace (not just on stdout).
  const traceDir = process.env.CHECKOUT_TRACE_DIR;
  const consoleTee: ConsoleTee | undefined =
    tracer && traceDir ? teeConsoleToFile(traceDir, startMs) : undefined;

  // 4c. Per-site skill: always-on recorder + read-back hints from any prior success.
  const recorder = new SkillRecorder(domain);
  const skillHints = buildSelectorHints(loadSiteSkill(domain));

  try {
    // 5. The page the checkout loop drives
    const page: Page = session.page;

    // 6. Inject domain cache cookies (before navigation)
    const existingCache = loadDomainCache(domain);
    if (existingCache) {
      try {
        await injectDomainCache(page, existingCache);
      } catch {
        // best-effort cookie restore
      }
    }

    // 6b. Seed login session cookies (session-token strategy) before navigation
    if (input.loginPlan?.sessionCookies?.length) {
      await seedSessionCookies(session.context, input.loginPlan.sessionCookies);
    }

    // 7. Navigate to product URL
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // 8a-verify. Redirect verification
    const finalUrl = page.url();
    try {
      const origDomain = extractDomain(url);
      const finalDomain = extractDomain(finalUrl);
      if (!briefDriven && origDomain !== finalDomain) {
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
        !briefDriven &&
        (["/search", "/find"].some(s => finalUrlObj.pathname.toLowerCase().includes(s)) ||
          ["q=", "query="].some(s => finalUrlObj.search.toLowerCase().includes(s)));
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

    // 8c. DOM pruning — strip purely non-functional elements to reduce token count.
    // CRITICAL: do NOT remove `[aria-hidden="true"]` elements. aria-hidden is a
    // screen-reader semantic, not a visibility flag — sites routinely wrap VISIBLE,
    // interactive content in it (a modal's backdropped page content, carousels, tab
    // panels, off-screen menus). On a Shopify product page with a cookie-consent
    // modal open, the entire product section (Add-to-Cart included) is aria-hidden;
    // removing it deletes the real page, collapsing it to zero actionable controls
    // and a blank screenshot — which looked like a bot-block but was self-inflicted.
    await page.evaluate(() => {
      document.querySelectorAll("noscript").forEach(e => e.remove());
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
      loggedIn: false,
      loginAttempts: 0,
      llmCalls: 0,
      pagesVisited: 0,
      lastUrl: page.url(),
      lastPageType: null,
      lastFingerprint: "",
      stallCount: 0,
      confirmationData: undefined,
    };

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      state.pagesVisited = pageIdx;

      // 9a. Wait for page to settle
      await page.waitForTimeout(2000);

      // 9b. Dismiss popups. A real Escape keypress (not a synthetic event) closes
      //     framework-driven modals whose backdrops otherwise intercept every click.
      await scriptedDismissPopups(page);
      try { await page.keyboard.press("Escape"); } catch { /* best-effort */ }

      // 9b-login. Opportunistic connected/agent account login. A visible password
      // field (or a sign-in form inside a dialog) means a login form is on screen —
      // even a MODAL login that never changed the URL or page-type. Driving it here
      // (not only on a detected login-gate page) is what lets "log in as the user"
      // actually happen on sites whose login is a header dropdown/modal. Capped so a
      // login that can't complete (e.g. site wants a password we don't hold) never
      // loops — the task continues as the priority.
      if (
        wantsAccountLogin(input.loginPlan) &&
        !state.loggedIn &&
        state.loginAttempts < 2
      ) {
        const hasLoginForm = await page
          .evaluate(() => {
            const visible = (el: Element | null): boolean =>
              !!el && (el as HTMLElement).offsetParent !== null;
            const pw = document.querySelector('input[type="password"]');
            if (visible(pw)) return true;
            // Email field + a visible "log in/sign in" submit inside a dialog/modal.
            const inDialog = document.querySelector(
              '[role="dialog"] input[type="email"], [aria-modal="true"] input[type="email"], [class*="login" i] input[type="email"], [class*="signin" i] input[type="email"]',
            );
            if (!visible(inDialog)) return false;
            const btns = Array.from(
              document.querySelectorAll('button, [role="button"], input[type="submit"]'),
            );
            return btns.some((b) => {
              if (!visible(b)) return false;
              const t = `${(b.textContent || "")} ${(b as HTMLInputElement).value || ""}`.toLowerCase();
              return /\b(log ?in|sign ?in)\b/.test(t);
            });
          })
          .catch(() => false);
        if (hasLoginForm) {
          state.loginAttempts++;
          try {
            const r = await executeLogin(page, session.context, input.loginPlan);
            if (r.advanced) {
              state.loggedIn = true;
              console.log(`  [login] connected-account login: ${r.note ?? input.loginPlan?.strategy}`);
            } else {
              console.log(`  [login] attempt ${state.loginAttempts} did not complete (${r.note ?? "no progress"}); continuing task`);
            }
          } catch (err) {
            console.log(`  [login error] ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
          }
          await page.waitForTimeout(2000);
        }
      }

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

      // 9c-trace. Snapshot the page on entry and advance the step tracker.
      tracer?.stepTracker.setStep(state.currentStep);
      const shot = await tracer?.snapshot(page, `${pageIdx}-${pageType}`);
      let iterMode: TraceMode = "scripted";
      let iterAction = `page:${pageType}`;

      // 9c-skill. Record the page in the flow, and wrap scripted clicks/selects so
      // the literal selector that matched is captured for the site skill.
      recorder.observePage(pageIdx, pageType, page.url());
      const recClick = (target: string): Promise<boolean> =>
        scriptedClickButton(page, target, (m) =>
          recorder.recordSelector({
            pageType,
            action: "click-button",
            fieldLabel: target,
            matchedSelector: m.selector ?? `text=${m.text}`,
            provenance: "STRUCTURAL",
          }),
        );
      const recSelect = (target: string, ty: "radio" | "checkbox" = "radio"): Promise<boolean> =>
        scriptedSelectOption(page, target, ty, (m) =>
          recorder.recordSelector({
            pageType,
            action: "select-option",
            fieldLabel: target,
            matchedSelector: m.selector ?? `text=${m.text}`,
            provenance: "SELECTION",
          }),
        );
      // Read-back: try selectors known to work on this page type from a prior run.
      const tryKnownClick = async (): Promise<boolean> => {
        for (const sel of skillHints.forClick(pageType)) {
          if (await scriptedClickSelector(page, sel)) {
            recorder.recordSelector({
              pageType,
              action: "click-button",
              fieldLabel: "known",
              matchedSelector: sel,
              provenance: "STRUCTURAL",
            });
            return true;
          }
        }
        return false;
      };

      // 9d. Run page-type handler (all scripted, 0 LLM)
      let advanced = false;

      switch (pageType) {
        case "donation-landing": {
          if (briefDriven) break; // brief-driven; LLM fallback handles it
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
              if (await recSelect(v, "radio")) {
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
              await recSelect("one-time", "radio") ||
              await recSelect("one time", "radio") ||
              await recSelect("just once", "radio");
            if (oneTimeSelected) console.log(`  [donation] selected one-time frequency`);
          }

          // Step 3: Click payment button (only if amount was selected)
          if (amountSelected) {
            await page.waitForTimeout(500);
            advanced =
              await recClick("donate by credit") ||
              await recClick("donate by card") ||
              await recClick("credit card") ||
              await recClick("credit/debit card") ||
              await recClick("donate now") ||
              await recClick("continue") ||
              await recClick("donate") ||
              await recClick("give now");
            if (advanced) console.log(`  [donation] clicked payment button`);
          }

          // If amount selection failed → advanced stays false → LLM fallback
          if (!amountSelected && price) {
            console.log(`  [donation] scripted amount selection failed for $${price}`);
          }
          break;
        }

        case "product": {
          if (briefDriven) break; // a task page misdetected as product — brief drives it
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
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeout: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
            break;
          }

          // Check for out-of-stock / unavailable variant before trying ATC.
          // An ENABLED add-to-cart/buy-now control means the product is purchasable,
          // so it overrides stray "notify me"/"sold out" text elsewhere on the page
          // (e.g. a back-in-stock widget for a different color/size swatch). Only when
          // there is no purchasable control AND an unavailable signal do we bail.
          const isUnavailable = await page.evaluate(() => {
            const atcLabels = [
              "add to cart", "add to bag", "add to basket",
              "buy now", "ship it", "deliver it",
            ];
            const unavailableTexts = [
              "option not available", "sold out", "out of stock",
              "unavailable", "notify me", "coming soon", "not available",
              "currently out", "temporarily out",
            ];
            const controls = Array.from(
              document.querySelectorAll('button, input[type="submit"], [role="button"]'),
            );
            const labelOf = (el: Element): string => {
              const value = el instanceof HTMLInputElement ? el.value : "";
              return `${(el.textContent || "").trim()} ${value}`.toLowerCase();
            };
            const isDisabled = (el: Element): boolean =>
              (el as HTMLButtonElement | HTMLInputElement).disabled === true ||
              el.getAttribute("aria-disabled") === "true";

            // A purchasable control present and enabled → in stock.
            const hasEnabledAtc = controls.some((el) => {
              const label = labelOf(el);
              return atcLabels.some((a) => label.includes(a)) && !isDisabled(el);
            });
            if (hasEnabledAtc) return null;

            // No purchasable control — surface the first explicit unavailable signal.
            for (const el of controls) {
              const label = labelOf(el);
              const hit = unavailableTexts.find((s) => label.includes(s));
              if (hit) return hit;
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
            (await tryKnownClick()) ||
            await recClick("buy now") ||
            await recClick("add to cart") ||
            await recClick("add to bag") ||
            await recClick("add to basket") ||
            await recClick("ship it") ||
            await recClick("deliver it");
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
                await recClick("checkout") ||
                await recClick("proceed to checkout") ||
                await recClick("go to checkout") ||
                await recClick("secure checkout") ||
                await recClick("view bag") ||
                await recClick("view cart");
              // If no checkout button found, navigate directly to /checkout
              if (!advanced) {
                console.log(`  [product] no checkout button in drawer, navigating to /checkout`);
                try {
                  const checkoutUrl = new URL(page.url());
                  checkoutUrl.pathname = "/checkout";
                  checkoutUrl.search = "";
                  await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeout: 15000 });
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
          if (briefDriven) break; // brief-driven; LLM fallback handles it
          advanced =
            (await tryKnownClick()) ||
            await recClick("checkout") ||
            await recClick("proceed to checkout") ||
            await recClick("continue to checkout") ||
            await recClick("secure checkout") ||
            await recClick("go to checkout") ||
            await recClick("start checkout") ||
            await recClick("begin checkout");
          // Fallback: navigate directly to /checkout if buttons didn't work
          if (!advanced) {
            console.log(`  [cart] no checkout button found, navigating to /checkout`);
            try {
              const checkoutUrl = new URL(page.url());
              checkoutUrl.pathname = "/checkout";
              checkoutUrl.search = "";
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeout: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }
          break;
        }

        case "login-gate": {
          // If an identity strategy was resolved upstream, log in with it.
          const loginResult = await executeLogin(
            page,
            session.context,
            input.loginPlan,
          );
          if (loginResult.handled) {
            console.log(`  [login] ${loginResult.note ?? input.loginPlan?.strategy}`);
            iterMode = "login";
            iterAction = `login:${loginResult.note ?? input.loginPlan?.strategy ?? "unknown"}`;
            advanced = loginResult.advanced;
            break;
          }
          // Otherwise fall back to guest checkout (default behavior).
          advanced =
            await recClick("guest checkout") ||
            await recClick("continue as guest") ||
            await recClick("continue without account") ||
            await recClick("guest") ||
            await recClick("checkout as guest") ||
            await recClick("continue without signing in") ||
            await recClick("skip sign in") ||
            await recClick("shop as guest") ||
            await recClick("checkout without an account") ||
            await recClick("no thanks");
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
                  await recClick("verify") ||
                  await recClick("submit") ||
                  await recClick("continue") ||
                  await recClick("confirm");
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
          if (briefDriven) break; // a task's own form fields — brief drives the fill, not scripted shipping
          const shipResult = await scriptedFillShipping(
            page, shippingData, skillHints.fillHintsFor("fill-shipping"),
          );
          const filled = shipResult.filled;
          for (const m of shipResult.matched) {
            recorder.recordSelector({
              pageType, action: "fill-shipping",
              fieldLabel: m.field, matchedSelector: m.selector, provenance: "USER_INPUT",
            });
          }
          state.shippingFilled = filled.length > 0;
          if (filled.length > 0) {
            console.log(`  [shipping] filled ${filled.length} fields: ${filled.join(", ")}`);
          }

          // If scripted fill got < 3 fields, supplement with LLM using variables
          if (filled.length < 3 && state.llmCalls < MAX_LLM_CALLS) {
            console.log(`  [shipping] only ${filled.length} fields via script, supplementing with LLM`);
            try {
              await playwrightAct(
                page,
                `Fill the shipping/contact form (email, full name, street address, city, state, zip, phone). Skip any fields already filled.`,
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
              await recClick("continue") ||
              await recClick("continue to payment") ||
              await recClick("next") ||
              await recClick("save and continue") ||
              await recClick("continue to shipping");
          }
          break;
        }

        case "payment-form":
        case "payment-gateway": {
          // Combined checkout pages (Glossier, etc.) show shipping + payment on same page.
          // Fill shipping first if not done yet.
          if (!state.shippingFilled) {
            const shipResult2 = await scriptedFillShipping(
              page, shippingData, skillHints.fillHintsFor("fill-shipping"),
            );
            const shippingFilled = shipResult2.filled;
            for (const m of shipResult2.matched) {
              recorder.recordSelector({
                pageType, action: "fill-shipping",
                fieldLabel: m.field, matchedSelector: m.selector, provenance: "USER_INPUT",
              });
            }
            state.shippingFilled = shippingFilled.length > 0;
            if (shippingFilled.length > 0) {
              console.log(`  [payment-page shipping] filled ${shippingFilled.length} fields: ${shippingFilled.join(", ")}`);
            }
            // Supplement with LLM if scripted got < 3 fields
            if (shippingFilled.length < 3 && state.llmCalls < MAX_LLM_CALLS) {
              console.log(`  [payment-page shipping] only ${shippingFilled.length} fields via script, supplementing with LLM`);
              try {
                await playwrightAct(
                  page,
                  `Fill the shipping/contact form fields on this page (email, full name, street address, city, state, zip, phone). Skip any fields already filled.`,
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
            await recClick("continue") ||
              await recClick("continue to payment") ||
              await recClick("next") ||
              await recClick("save and continue");
            await page.waitForTimeout(2000);
          }

          // Dry run (no-spend oversight): never type a card. Skip the entire
          // card/billing fill and go straight to the parked-at-payment return.
          if (!input.dryRun && !state.cardFilled) {
            // Uncheck billing same as shipping
            await scriptedUncheckBillingSameAsShipping(page);
            await page.waitForTimeout(500);

            // Fill card fields
            const cardResult = await scriptedFillCardFields(
              page, cdpCreds, skillHints.fillHintsFor("fill-card"),
            );
            state.cardFilled = cardResult.filled > 0;
            console.log(`  [card] filled ${cardResult.filled} fields via ${cardResult.method}`);
            for (const m of cardResult.matched) {
              // CDP_SECRET: label + selector only — never a card value.
              recorder.recordSelector({
                pageType, action: "fill-card",
                fieldLabel: m.field, matchedSelector: m.selector, provenance: "CDP_SECRET",
              });
            }

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
            // Dry run: extract total and stop — parked at the payment page,
            // no card issued, no order placed.
            const total = await extractVisibleTotal(page);
            state.confirmationData = { total };
            state.currentStep = "place-order";
            console.log(`  [dry-run] PARKED at payment, total=${total ?? "(not found)"}`);
            advanced = true; // Signal completion
            tracer?.stepTracker.setStep("place-order");
            const parkedShot = await tracer?.snapshot(page, "PARKED-payment");
            tracer?.record({
              pageIndex: pageIdx,
              url: page.url(),
              pageType,
              action: "parked-before-place-order",
              mode: "navigate",
              loginStrategy: input.loginPlan?.strategy,
              advanced: true,
              llmCalls: state.llmCalls,
              screenshot: parkedShot,
              note: `observed_total=${total ?? "(not found)"}`,
              details: { observed_total: total ?? undefined, parked_at: "payment" },
              outcome: "pass",
            });
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
              parkedAtPayment: true,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              durationMs,
            };
          }

          // Live: click place order — try multiple common button labels
          advanced =
            (await tryKnownClick()) ||
            await recClick("place order") ||
            await recClick("complete purchase") ||
            await recClick("submit order") ||
            await recClick("donate") ||
            await recClick("pay now") ||
            await recClick("complete order") ||
            await recClick("confirm order") ||
            await recClick("pay") ||
            await recClick("submit payment");

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

          // Persist the per-site skill (best-effort; never fails the purchase).
          await persistSkill(recorder, domain);

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
              await page.goto(`${origin}/cart`, { waitUntil: "domcontentloaded", timeout: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }
          break;
        }
      }

      // 9d-trace. Record the scripted handler outcome for this page.
      tracer?.record({
        pageIndex: pageIdx,
        url: page.url(),
        pageType,
        action: iterAction,
        mode: iterMode,
        loginStrategy: input.loginPlan?.strategy,
        advanced,
        stallCount: state.stallCount,
        llmCalls: state.llmCalls,
        screenshot: shot,
        outcome: advanced ? "pass" : undefined,
      });

      // 9e. Stall detection — track URL + page type to detect no-progress loops.
      //     A task flow fills a multi-field form without navigating, so URL+pageType
      //     alone reads as "stalled" even while real progress happens. Fold in a cheap
      //     DOM fingerprint (filled-input count + total typed length) so form progress
      //     on the same page counts as advance.
      const currentUrl = page.url();
      const fingerprint = briefDriven
        ? await page
            .evaluate(() => {
              const inputs = Array.from(document.querySelectorAll("input, select, textarea")) as HTMLInputElement[];
              let filled = 0;
              let len = 0;
              for (const el of inputs) {
                const v = (el.value || "").trim();
                if (v) { filled++; len += v.length; }
              }
              // Fold in interactive-element count so DOM changes (new options
              // rendering, a drawer opening) count as real progress. Deliberately
              // NOT scroll position: a stall must still accrue while we scroll-nudge
              // a stuck page, both so we eventually give up and so the nudge fires.
              const interactive = document.querySelectorAll(
                'a, button, input, select, textarea, [role="button"], [role="option"]',
              ).length;
              return `${filled}:${len}:${interactive}`;
            })
            .catch(() => "")
        : "";
      const sameContent =
        currentUrl === state.lastUrl &&
        pageType === state.lastPageType &&
        (!briefDriven || fingerprint === state.lastFingerprint);
      if (sameContent) {
        state.stallCount++;
        console.log(`  [stall] same url+page type ${state.stallCount} times`);
      } else {
        state.stallCount = 0;
      }
      state.lastUrl = currentUrl;
      state.lastPageType = pageType;
      state.lastFingerprint = fingerprint;

      // Break out if completely stuck on same page. Brief-driven tasks get a larger
      // budget (more distinct pages, every page is an LLM step).
      const stuckLimit = briefDriven ? 9 : 5;
      if (state.stallCount >= stuckLimit) {
        console.log(`  [stuck] ${state.stallCount} stalls on ${pageType} — giving up`);
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

          await persistSkill(recorder, domain);

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
      if (needsLlm && state.llmCalls < maxLlm) {
        const isStalled = state.stallCount >= 2;
        const instruction = buildPageInstruction(pageType, input, state, isStalled);

        // Scroll nudge: a form-flow page that won't advance is usually one where the
        // option to act on (a selectable row, a price, a Continue button) is below
        // the fold and the model won't scroll on its own. Deterministically cycle the
        // viewport down the page each stall so the next screenshot reveals new
        // content; wrap back to the top after reaching the bottom. Generic — no
        // site-specific selectors.
        if (briefDriven && isStalled) {
          await page
            .evaluate(() => {
              const atBottom =
                window.scrollY + window.innerHeight >= document.body.scrollHeight - 60;
              if (atBottom) window.scrollTo({ top: 0 });
              else window.scrollBy({ top: Math.round(window.innerHeight * 0.7) });
            })
            .catch(() => {});
          await page.waitForTimeout(500);
        }

        console.log(`  [llm fallback ${state.llmCalls + 1}/${maxLlm}${isStalled ? " STALLED" : ""}] ${instruction.slice(0, 100)}...`);
        tracer?.record({
          pageIndex: pageIdx,
          url: page.url(),
          pageType,
          action: `llm-act:${instruction.slice(0, 80)}`,
          mode: "llm",
          loginStrategy: input.loginPlan?.strategy,
          stallCount: state.stallCount,
          llmCalls: state.llmCalls + 1,
          note: isStalled ? "stalled" : undefined,
        });

        try {
          // The iterative executor re-snapshots between actions and types with real
          // keystrokes, so it can drive dynamic widgets (autocomplete suggestion
          // lists, date pickers, steppers) that a single-pass `.fill()` can't. Used
          // for every LLM fallback — it's a strict superset of the single-pass path.
          await playwrightAct(page, instruction, {
            variables: stagehandVars,
            iterative: true,
            // Form-flow pages (a multi-field search/booking form) need more in-page
            // rounds to fill several widgets (autocompletes, date picker, steppers)
            // and then submit, before the outer loop re-detects the page. The product
            // page genuinely needs its rounds too — dismissing popups, selecting a
            // variant, and scrolling the Add-to-Cart button into view — so we keep
            // the default. (Per-request LLM latency is bounded by the timeout in
            // llm.ts, which was the real cause of the long product-page stalls.)
            maxSteps: briefDriven ? 10 : undefined,
            // Card data may be present on payment pages → aggressively redact
            // the screenshot (cover every input/iframe) so a CDP-filled PAN
            // can never reach the vision model.
            containsCardData:
              pageType === "payment-form" || pageType === "payment-gateway",
          });
          state.llmCalls++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  [llm error] ${msg.slice(0, 100)}`);
          state.llmCalls++;
        }

        // After LLM on product page, mark selections as applied and try scripted ATC
        if (pageType === "product" && !briefDriven) {
          // Mark selections as applied after first LLM attempt
          if (input.selections && Object.keys(input.selections).length > 0) {
            state.selectionsApplied = true;
          }

          // Only try ATC if not already added
          if (!state.addedToCart) {
            await page.waitForTimeout(1000);
            const postLlmAtc =
              await recClick("buy now") ||
              await recClick("add to cart") ||
              await recClick("add to bag") ||
              await recClick("add to basket") ||
              await recClick("ship it") ||
              await recClick("deliver it");
            if (postLlmAtc) {
              state.addedToCart = true;
              console.log(`  [post-llm] scripted add-to-cart succeeded`);
              // Wait for navigation (buy now) or cart drawer
              await page.waitForTimeout(3000);
              // Try checkout buttons in cart drawer
              const wentToCheckout =
                await recClick("checkout") ||
                await recClick("proceed to checkout") ||
                await recClick("go to checkout") ||
                await recClick("view bag") ||
                await recClick("view cart");
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

          await persistSkill(recorder, domain);

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
      } else if (needsLlm && state.llmCalls >= maxLlm) {
        console.log(`  [budget exhausted] ${state.llmCalls}/${maxLlm} LLM calls used`);
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

    // 11. Price verification — only for a concrete product with a known price.
    // A form_flow (a multi-step booking/reservation) has no single fixed product price to compare,
    // and a no-spend run legitimately ends without a final total, so a "$34 vs
    // $0.00" mismatch here is noise, not a failure.
    if (finalTotal && order.payment.price && !briefDriven) {
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

    // Persist the per-site skill on a text-confirmed success (best-effort).
    if (confirmedViaPageText) await persistSkill(recorder, domain);

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
    // Roll up the run into summary.json, then stop mirroring console to run.log.
    // Both are best-effort and must never mask a real checkout error.
    try {
      tracer?.writeSummary();
    } catch {
      /* best-effort */
    }
    consoleTee?.stop();
    // Close the local browser session
    await destroySession(session);
  }
}
