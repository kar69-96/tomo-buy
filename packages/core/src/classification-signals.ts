/**
 * Shared classification signals for page type detection.
 *
 * Used by both the Stagehand engine (DOM-based via page.evaluate())
 * and the HTTP engine (cheerio-based HTML parsing). Signal arrays
 * are engine-agnostic — each engine applies them against its own
 * DOM model.
 *
 * ┌──────────────────────────────┐
 * │   classification-signals.ts  │  ← YOU ARE HERE (shared constants)
 * │                              │
 * │  ┌────────────┐  ┌────────┐ │
 * │  │ Stagehand  │  │ HTTP   │ │
 * │  │ classifier │  │ class. │ │
 * │  │ (DOM eval) │  │(cheerio│ │
 * │  └────────────┘  └────────┘ │
 * └──────────────────────────────┘
 */

// ---- Page types detected by analysis ----

export type PageType =
  | "donation-landing"
  | "product"
  | "cart"
  | "login-gate"
  | "email-verification"
  | "shipping-form"
  | "payment-form"
  | "payment-gateway"
  | "confirmation"
  | "error"
  | "unknown";

// ---- Card field selectors ----

export const CARD_SELECTORS: readonly string[] = [
  'input[name*="cardnumber" i], input[name*="card-number" i], input[name*="encryptedCardNumber" i], input[autocomplete="cc-number"], input[name="number"], input[placeholder*="card number" i], input[data-testid*="card" i]',
  'input[name*="exp" i], input[name*="encryptedExpiryDate" i], input[autocomplete="cc-exp"], input[autocomplete="cc-exp-month"], input[name*="month" i][name*="exp" i]',
  'input[name*="cvc" i], input[name*="cvv" i], input[name*="encryptedSecurityCode" i], input[autocomplete="cc-csc"], input[name*="security" i], input[placeholder*="security" i]',
];

export const CARD_FIELD_MAP: ReadonlyArray<{ selector: string; credKey: string }> = [
  { selector: 'input[name*="cardnumber" i], input[name*="card-number" i], input[name*="encryptedCardNumber" i], input[autocomplete="cc-number"], input[name="number"], input[placeholder*="card number" i], input[data-testid*="card" i]', credKey: "x_card_number" },
  { selector: 'input[name*="exp" i], input[name*="encryptedExpiryDate" i], input[autocomplete="cc-exp"]', credKey: "x_card_expiry" },
  { selector: 'input[name*="cvc" i], input[name*="cvv" i], input[name*="encryptedSecurityCode" i], input[autocomplete="cc-csc"], input[name*="security" i], input[placeholder*="security" i]', credKey: "x_card_cvv" },
  { selector: 'input[name*="holderName" i], input[name*="cardholder" i], input[autocomplete="cc-name"]', credKey: "x_cardholder_name" },
];

export const EXPIRY_MONTH_SELECTORS: readonly string[] = [
  'select[name*="month" i]', 'input[name*="month" i]',
  'select[autocomplete="cc-exp-month"]', 'input[autocomplete="cc-exp-month"]',
  'select[name*="exp_month" i]', 'input[name*="exp_month" i]',
];

export const EXPIRY_YEAR_SELECTORS: readonly string[] = [
  'select[name*="year" i]', 'input[name*="year" i]',
  'select[autocomplete="cc-exp-year"]', 'input[autocomplete="cc-exp-year"]',
  'select[name*="exp_year" i]', 'input[name*="exp_year" i]',
];

// ---- Payment iframe selectors ----

export const PAYMENT_IFRAME_SELECTORS =
  'iframe[src*="pay" i], iframe[src*="card" i], iframe[src*="adyen" i], ' +
  'iframe[src*="stripe" i], iframe[src*="braintree" i], iframe[name*="card" i]';

// ---- Add-to-cart selectors ----

export const ADD_TO_CART_SELECTORS =
  'button[class*="add-to-cart" i], button[name*="add" i], ' +
  'input[value*="add to cart" i], button[data-action*="add-to-cart" i], ' +
  'form[action*="cart"] button[type="submit"], ' +
  'button[data-testid*="add" i], button[id*="add-to-cart" i], ' +
  'button[aria-label*="add to cart" i], button[aria-label*="add to bag" i], ' +
  'button[data-testid*="add-to-cart" i], [data-action="add-to-cart"], ' +
  'form[action*="/cart/add"] button, ' +
  'button[data-test*="add-to-cart" i], button[data-test*="addToCart" i], ' +
  '[data-test="shipItButton"], [data-test="orderPickupButton"]';

export const ADD_TO_CART_TEXT_SIGNALS: readonly string[] = [
  "add to cart", "add to bag", "add to basket", "buy now",
  "add it to your cart", "add item", "add to order",
  "ship it", "pick it up", "deliver it",
];

// ---- Donation signals ----

export const DONATION_TEXT_SIGNALS: readonly string[] = [
  "donate", "donation", "contribution", "give now",
];

export const DONATION_BUTTON_SELECTOR =
  'button[value*="donate" i], a[href*="donate" i], input[value*="donate" i]';

export const DONATION_AMOUNT_SELECTOR =
  '[class*="amount" i], [name*="amount" i], input[type="radio"][name*="amount" i]';

// ---- Confirmation signals ----

export const CONFIRMATION_TEXT_SIGNALS: readonly string[] = [
  "thank you for your order", "order confirmed", "order number",
  "confirmation number", "order placed", "purchase complete",
  "successfully placed", "thank you for your donation",
  "we received your order", "your order has been",
];

export const CONFIRMATION_URL_PATTERNS: readonly string[] = [
  "/confirmation", "/thank-you", "/order-complete", "/order-confirmation",
];

// ---- Error signals ----

export const PAYMENT_DECLINE_SIGNALS: readonly string[] = [
  "card was declined", "card has been declined", "payment was declined",
  "payment declined", "transaction was declined", "transaction declined",
  "your card was denied", "payment was not successful",
  "unable to process your payment", "could not process your payment",
  "payment could not be completed", "we couldn't process your payment",
  "transaction failed", "payment failed", "insufficient funds", "do not honor",
];

export const CARD_INVALID_SIGNALS: readonly string[] = [
  "invalid card number", "card number is invalid", "card has expired",
  "incorrect cvc", "incorrect cvv", "security code is incorrect",
  "card was not accepted", "card is not supported",
];

export const OUT_OF_STOCK_SIGNALS: readonly string[] = [
  "sold out", "out of stock", "no longer available", "item is unavailable",
  "option not available", "currently unavailable",
];

export const CHECKOUT_ERROR_SIGNALS: readonly string[] = [
  "something went wrong", "an error occurred", "please try again",
  "purchase failed", "order could not be placed", "order could not be completed",
  "unable to place your order", "unable to complete your order",
  "we were unable to process", "there was a problem with your order",
];

/** All error text signals combined (for page classification). */
export const ALL_ERROR_TEXT_SIGNALS: readonly string[] = [
  ...PAYMENT_DECLINE_SIGNALS,
  ...CARD_INVALID_SIGNALS,
  ...OUT_OF_STOCK_SIGNALS,
  ...CHECKOUT_ERROR_SIGNALS,
];

export const ERROR_CSS_SELECTORS: readonly string[] = [
  '[role="alert"]', '[class*="error" i]', '[class*="decline" i]',
  '[class*="alert-danger" i]', '[class*="alert-error" i]',
  '[class*="payment-error" i]', '[class*="form-error" i]',
  '[data-testid*="error" i]', '[id*="error-message" i]',
];

export const ERROR_CONFIRMING_PHRASES: readonly string[] = [
  "declined", "failed", "invalid", "expired", "denied",
  "unable to", "could not", "cannot", "error", "problem",
  "sold out", "out of stock", "unavailable", "insufficient",
];

// ---- Login / auth gate signals ----

export const LOGIN_TEXT_SIGNALS: readonly string[] = [
  "sign in", "log in", "create account", "guest checkout",
  "continue as guest", "checkout as guest", "sign-in", "email or mobile",
  "sign up", "register", "returning customer", "new customer",
  "have an account", "already a member", "shop as guest",
];

// ---- Cart signals ----

export const CART_TEXT_SIGNALS: readonly string[] = [
  "your cart", "shopping cart", "cart total", "order summary",
];

export const CHECKOUT_BUTTON_SELECTOR =
  'a[href*="checkout" i], button[class*="checkout" i], input[value*="checkout" i]';

// ---- Shipping form selectors ----

export const SHIPPING_FIELD_SELECTORS: readonly string[] = [
  'input[autocomplete="given-name"]', 'input[autocomplete="address-line1"]',
  'input[name*="firstName" i]', 'input[name*="address1" i]',
  'input[autocomplete="shipping"]', 'input[autocomplete="name"]',
  'input[name*="fullName" i]', 'input[name*="full_name" i]',
  'input[name*="line1" i]', 'input[name*="streetAddress" i]',
  'input[name*="first_name" i]',
];

// ---- Verification / OTP signals ----

export const VERIFICATION_TEXT_SIGNALS: readonly string[] = [
  "verification code", "enter code", "enter the code",
  "we sent", "we've sent", "check your email",
  "confirm your email", "one-time", "otp",
];

export const OTP_INPUT_SELECTORS =
  'input[autocomplete="one-time-code"], ' +
  'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], ' +
  'input[name*="token" i], input[id*="code" i], input[id*="otp" i], ' +
  'input[maxlength="1"], input[maxlength="4"], input[maxlength="5"], ' +
  'input[maxlength="6"], input[maxlength="7"], input[maxlength="8"]';

// ---- Review order signals ----

export const REVIEW_ORDER_SIGNALS: readonly string[] = [
  "review your order", "review order", "order review",
  "review and pay", "confirm your order", "place your order",
];

// ---- SPA detection signals (multi-signal scoring) ----
//
// Score >= 3 → server-rendered (use HTTP)
// Score < 3  → needs browser rendering
//
// Each signal has a weight and a CSS selector or check description.

export interface SpaSignal {
  readonly name: string;
  readonly weight: number;
  /** CSS selector to check for presence. null = requires custom logic. */
  readonly selector: string | null;
  readonly description: string;
}

export const SPA_DETECTION_SIGNALS: readonly SpaSignal[] = [
  { name: "json_ld", weight: 3, selector: 'script[type="application/ld+json"]', description: "JSON-LD structured data present" },
  { name: "og_price", weight: 2, selector: 'meta[property="og:price:amount"], meta[property="product:price:amount"]', description: "Open Graph price meta tags" },
  { name: "form_action", weight: 3, selector: 'form[action][method]', description: "Form with action and method attributes" },
  { name: "hidden_inputs", weight: 2, selector: 'input[type="hidden"][name*="token" i], input[type="hidden"][name*="csrf" i]', description: "Hidden inputs with CSRF/token values" },
  { name: "framework_marker", weight: -2, selector: null, description: "JS framework markers (__NEXT_DATA__, __NUXT__, data-reactroot, ng-version)" },
  { name: "empty_mount", weight: -3, selector: null, description: "Empty SPA mount point (#app, #root, #__next with no/minimal children)" },
  { name: "skeleton_classes", weight: -2, selector: '[class*="skeleton" i], [class*="shimmer" i], [class*="placeholder" i][class*="loading" i]', description: "Skeleton/shimmer UI loading states" },
  { name: "minimal_text", weight: -3, selector: null, description: "Visible text content < 100 characters" },
  { name: "substantial_text", weight: 1, selector: null, description: "Visible text content > 500 characters" },
  { name: "noscript_content", weight: 1, selector: null, description: "<noscript> contains meaningful content" },
];

export const SPA_SCORE_THRESHOLD = 3;

// ---- Confirmation data extraction patterns ----

export const ORDER_NUMBER_PATTERNS: readonly RegExp[] = [
  /order\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
  /confirmation\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
  /reference\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
];

export const TOTAL_EXTRACTION_PATTERNS: readonly RegExp[] = [
  /(?:order\s*)?total\s*[:.]?\s*\$?\s*([\d,]+\.?\d{0,2})/i,
  /(?:amount\s*)?charged\s*[:.]?\s*\$?\s*([\d,]+\.?\d{0,2})/i,
  /\$\s*([\d,]+\.\d{2})/,
];
