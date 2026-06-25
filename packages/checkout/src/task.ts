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
import { runCuaTask } from "./cua/loop.js";
import { buildToolset } from "./cua/tools.js";
import type { ToolContext, CuaStatus } from "./cua/tools.js";
import { isChallengePage, waitForHumanToSolveChallenge } from "./captcha.js";
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
  /** True when a login-checkpoint run logged in and stopped before driving checkout. */
  parkedAtLogin?: boolean;
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
  /**
   * Login-checkpoint oversight: stop as soon as login has advanced, before
   * driving cart/payment. Lets a test exercise the login gate in isolation.
   * Generic — keys on the login executor's "advanced" signal, not any domain.
   */
  stopAfterLogin?: boolean;
}

/**
 * Whether to park immediately after login. True only when a login-checkpoint run
 * was requested AND the login executor actually advanced the form — so a run that
 * never finds a login form falls through to the normal flow (and the payment park).
 * Pure + exported for unit testing without a browser.
 */
export function shouldParkAfterLogin(
  stopAfterLogin: boolean | undefined,
  loginAdvanced: boolean,
): boolean {
  return stopAfterLogin === true && loginAdvanced === true;
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

/**
 * Build the objective for a concrete product purchase (the non-brief path). The
 * CUA drives every page from this objective + the tool set; we only state the
 * goal and the constraints (one unit, guest-vs-account, the dry-run payment
 * park). Tool mechanics live in the CUA system prompt, not here.
 */
function buildPurchaseObjective(input: CheckoutInput): string {
  const p = input.order.product;
  const dryRun = input.dryRun;
  const selections = input.selections;
  // When the product name is unknown (unpriced/failed discovery), say "item already
  // loaded" rather than embedding the raw URL — the model would otherwise type the
  // URL into a search bar instead of acting on the already-open page.
  const productLabel =
    p.name && p.name !== extractDomain(p.url)
      ? p.name
      : "the item already loaded in the browser";
  const lines: string[] = [
    `Objective: purchase this product and reach ${dryRun ? "the filled payment page" : "order confirmation"}: ${productLabel}.`,
  ];
  if (selections && Object.keys(selections).length > 0) {
    lines.push(
      `Select exactly these options: ${Object.entries(selections).map(([k, v]) => `${k}: ${v}`).join(", ")}.`,
    );
  }
  lines.push(QTY_GUIDANCE);
  // Account vs guest.
  if (input.loginPlan?.register) {
    // create_account was approved, but guest checkout is preferred when offered:
    // only register if the site won't let us proceed as a guest.
    lines.push(
      'ACCOUNT: a new agent account is available for this site if it is needed. Prefer GUEST checkout whenever it is offered. ONLY if the site refuses to let you check out as a guest (it requires an account) should you open the "Create account"/"Sign up" form and call the login tool — it registers you with your email and a new password (you never type them). Never let account creation block an otherwise-available guest checkout.',
    );
  } else if (wantsProactiveLogin(input.loginPlan)) {
    lines.push(
      'ACCOUNT: this task runs on the user\'s own account. If a "Log in"/"Sign in" form or dialog is visible, call the login tool ONCE to sign in (the email/password/2FA are handled for you). Never create a new account, and do NOT let login block progress — completing the purchase is the priority.',
    );
  } else if (wantsAccountLogin(input.loginPlan)) {
    lines.push(
      'If a sign-in form appears and signing in is needed to proceed, call the login tool (existing account only; never create a new account).',
    );
  } else {
    lines.push(
      "Check out as a guest. Do not create an account or sign in unless the page blocks all further progress without it.",
    );
  }
  lines.push(
    "Plan: (1) close any popup/cookie/promo overlay; (2) add the item to the cart — if a required size/variant must be chosen, pick the first in-stock one; (3) proceed to checkout; (4) fill the shipping/contact form with the fill_shipping tool (use type with a var name for any field it misses); (5) choose the cheapest shipping option; (6) on the payment page " +
      (dryRun
        ? "call read_total, then call finish with status parked_payment and the total. Do NOT call fill_card or place the order."
        : "call fill_card, then place the order, then call finish with status confirmation including the order number and total."),
  );
  return lines.join("\n");
}

/** Map a CUA terminal status to a checkout step for trace/reporting. */
function cuaStepFor(status: CuaStatus): CheckoutStep {
  switch (status) {
    case "confirmation":
      return "verify-confirmation";
    case "parked_payment":
      return "place-order";
    case "parked_login":
      return "proceed-to-checkout";
    default:
      return "checkout-error";
  }
}

/** Translate the CUA result into the checkout-engine result shape. */
async function mapCuaResult(
  cua: { status: CuaStatus; orderNumber?: string; total?: string; note?: string; toolCalls: number },
  base: { sessionId: string; replayUrl: string; durationMs: number; observedTotal?: string; page: Page },
): Promise<CheckoutResult> {
  const common = { sessionId: base.sessionId, replayUrl: base.replayUrl, durationMs: base.durationMs };
  switch (cua.status) {
    case "confirmation":
      return { success: true, orderNumber: cua.orderNumber, finalTotal: cua.total ?? base.observedTotal, ...common };
    case "parked_payment":
      return { success: true, parkedAtPayment: true, finalTotal: cua.total ?? base.observedTotal, ...common };
    case "parked_login":
      return { success: true, parkedAtLogin: true, ...common };
    default: {
      let pageText = "";
      try {
        pageText = await base.page.evaluate(() => document.body?.textContent || "");
      } catch {
        /* best-effort */
      }
      const msg = cua.note ?? `checkout did not complete (status ${cua.status}, ${cua.toolCalls} tool calls)`;
      return {
        success: false,
        finalTotal: base.observedTotal,
        failedStep: "place-order" as CheckoutStep,
        errorMessage: msg,
        errorCategory: classifyError(msg, pageText),
        ...common,
      };
    }
  }
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

// ---- Page-health (bot-block) classification ----

export interface PageHealthSignals {
  /** Trimmed body text length. */
  charCount: number;
  /** Whitespace-delimited word count of the body text. */
  wordCount: number;
  /** Count of VISIBLE interactive controls (links, buttons, inputs, selects). */
  visibleControls: number;
}

export interface PageHealthVerdict {
  blocked: boolean;
  reason?: string;
}

/**
 * Decide whether an initially-navigated page is unusable (bot-blocked, a
 * challenge wall, or a failed render) versus a real, actionable page. A genuine
 * product/checkout/search page always carries substantial text AND at least one
 * visible interactive control. A page with almost no text, or with zero visible
 * controls, can't be driven — fail fast with an accurate reason instead of
 * burning the whole LLM budget and mislabeling it a "stuck" step. Site-agnostic.
 */
export function classifyPageHealth(s: PageHealthSignals): PageHealthVerdict {
  if (s.charCount < 500 || s.wordCount < 50) {
    return {
      blocked: true,
      reason: `page rendered minimal content (${s.charCount} chars, ${s.wordCount} words) — site likely blocks automated browsers`,
    };
  }
  if (s.visibleControls === 0) {
    return {
      blocked: true,
      reason: `page rendered no actionable controls (0 visible links/buttons/inputs) — likely a challenge wall or failed render`,
    };
  }
  return { blocked: false };
}

// ---- Navigation ----

/**
 * Navigate to a URL, retrying once with a short backoff on a transient failure
 * (timeout / reset). A single flaky goto shouldn't kill an otherwise-fine run.
 * Generic; no per-site logic. Throws the last error if every attempt fails.
 */
async function gotoWithRetry(
  page: Page,
  url: string,
  timeoutMs = 30000,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(`  [navigate] attempt ${attempt + 1} failed: ${msg}`);
      if (attempt === 0) await page.waitForTimeout(2000);
    }
  }
  throw lastErr;
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

    // 7. Navigate to product URL. Navigation can flake (a slow first byte, a
    //    transient timeout) on an otherwise-fine site, so retry once with backoff
    //    before declaring the run dead. Generic — no per-site logic.
    await gotoWithRetry(page, url);
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

    // 8a-bot. Bot-block detection — minimal content OR no actionable controls
    // signal a bot-blocked / challenge / failed-render page (see classifyPageHealth).
    try {
      const signals = await page.evaluate(() => {
        const bodyText = (document.body?.textContent || "").trim();
        const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const controls = Array.from(
          document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]'),
        ).filter(visible);
        return {
          charCount: bodyText.length,
          wordCount: bodyText.split(/\s+/).filter((w) => w.length > 0).length,
          visibleControls: controls.length,
        };
      });
      let verdict = classifyPageHealth(signals);
      if (verdict.blocked) {
        // We have no stealth/Browserbase, so we can't auto-defeat a bot wall. But on
        // a headful run (HEADLESS=false) a human is watching the window — if this is
        // an actual CAPTCHA/challenge, give them a window to solve it by hand, then
        // re-check. Generic: keyed only on standard challenge markers, never a domain.
        const headful = process.env.HEADLESS === "false";
        if (headful && (await isChallengePage(page))) {
          const cleared = await waitForHumanToSolveChallenge(page);
          if (cleared) {
            const reSignals = await page.evaluate(() => {
              const bodyText = (document.body?.textContent || "").trim();
              const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
              const controls = Array.from(
                document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]'),
              ).filter(visible);
              return {
                charCount: bodyText.length,
                wordCount: bodyText.split(/\s+/).filter((w) => w.length > 0).length,
                visibleControls: controls.length,
              };
            });
            verdict = classifyPageHealth(reSignals);
          }
        }
      }
      if (verdict.blocked) {
        console.log(
          `  [bot-blocked] ${verdict.reason} (${signals.charCount} chars, ${signals.wordCount} words, ${signals.visibleControls} controls)`,
        );
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `bot_blocked: ${verdict.reason}`,
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

    // 9. Drive the page with the computer-use agent (CUA). One strong model,
    //    holding the full conversation across the whole task, calls browser +
    //    capability tools to accomplish the objective. Scripted logic survives
    //    ONLY inside those tools (login, card/shipping fill, OTP) — never as a
    //    page-type control-flow switch. Secrets stay server-side in the tools.
    const objective = (() => {
      const base =
        briefDriven && input.brief
          ? buildBriefInstruction(input.brief, input.dryRun, input.loginPlan)
          : buildPurchaseObjective(input);
      return input.stopAfterLogin
        ? `${base}\nAs soon as you are signed in, call finish with status parked_login — do NOT continue to the cart or payment.`
        : base;
    })();

    const toolContext: ToolContext = {
      page,
      context: session.context,
      variables: stagehandVars,
      cdpCreds,
      shippingData,
      loginPlan: input.loginPlan,
      agentInboxId,
      domain,
      dryRun: input.dryRun,
      log: (m) => console.log(`    ${m}`),
    };
    // PII + card values are redacted from screenshots (defense-in-depth). They
    // only ever reach the redactor here — never the model prompt or a tool arg.
    const piiValues = [
      ...Object.values(stagehandVars),
      ...Object.values(cdpCreds),
    ].filter((v) => typeof v === "string" && v.length >= 4);

    tracer?.stepTracker.setStep("navigate");
    await tracer?.snapshot(page, "cua-start");

    const cua = await runCuaTask({
      objective,
      tools: buildToolset({ dryRun: input.dryRun }),
      toolContext,
      piiValues,
      log: (m) => console.log(m),
    });

    console.log(
      `  [cua] finished: status=${cua.status} toolCalls=${cua.toolCalls} rounds=${cua.rounds}${cua.note ? ` (${cua.note})` : ""}`,
    );

    // Best-effort observed total + domain cache for the receipt/oversight view.
    let observedTotal = cua.total;
    if (!observedTotal) {
      try {
        observedTotal = await extractVisibleTotal(page);
      } catch {
        /* best-effort */
      }
    }

    tracer?.stepTracker.setStep(cuaStepFor(cua.status));
    const finalShot = await tracer?.snapshot(page, `cua-final-${cua.status}`);
    tracer?.record({
      pageIndex: 0,
      url: page.url(),
      pageType: "unknown",
      action: `cua:${cua.status}`,
      mode: "llm",
      loginStrategy: input.loginPlan?.strategy,
      advanced: cua.status !== "stopped" && cua.status !== "error",
      llmCalls: cua.toolCalls,
      screenshot: finalShot,
      note: cua.note,
      details: {
        observed_total: observedTotal ?? undefined,
        parked_at:
          cua.status === "parked_payment"
            ? "payment"
            : cua.status === "parked_login"
              ? "login"
              : undefined,
      },
      outcome: cua.status === "error" || cua.status === "stopped" ? undefined : "pass",
    });

    try {
      saveDomainCache(await extractDomainCache(page, domain));
    } catch {
      /* best-effort */
    }

    return mapCuaResult(cua, {
      sessionId: session.id,
      replayUrl: session.replayUrl,
      durationMs: Date.now() - startMs,
      observedTotal,
      page,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // A "Target page/context/browser has been closed" error is teardown racing an
    // in-flight page op (the run was killed/torn down, or the browser crashed) — not
    // a checkout-logic bug. Tag it distinctly so it's not mistaken for one, and so
    // run.json doesn't read it as a navigation failure.
    const closed = /has been closed|Target (page|closed)|browser has been closed/i.test(raw);
    return {
      success: false,
      sessionId: session.id,
      replayUrl: session.replayUrl,
      failedStep: "navigate" as CheckoutStep,
      errorMessage: closed ? `session_closed: ${raw}` : raw,
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
