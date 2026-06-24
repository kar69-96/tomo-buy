/**
 * Live E2E fixtures — real sites + tasks for the three login scenarios.
 *
 * Every URL is overridable via env so you can point a run at a known-good, cheap,
 * in-stock product without editing code (real storefronts go out of stock).
 */

/**
 * A generic guest-checkout storefront product. The default is a single-variant,
 * in-stock Shopify item that drives cleanly to a parked payment page (no size or
 * subscription toggle to block Add-to-Cart). Catalogs change — if it goes out of
 * stock, override with another current product URL:
 *   E2E_GUEST_URL=<a current product URL>
 */
export const GUEST_PRODUCT_URL =
  process.env.E2E_GUEST_URL ?? "https://www.primalkitchen.com/products/dijon-mustard";

/** A generic storefront for the new-agent-account scenario (override as above). */
export const NEW_ACCOUNT_PRODUCT_URL =
  process.env.E2E_NEW_ACCOUNT_URL ?? "https://www.primalkitchen.com/products/dijon-mustard";

/** The user's existing-account service (airline check-in / booking). */
export const FRONTIER_URL =
  process.env.E2E_FRONTIER_URL ?? "https://www.flyfrontier.com";

/**
 * A major retailer where the user has an account (Amazon). Used for the
 * personal-account login path (connected_otp / connected_session). Override with
 * a current in-stock product URL via E2E_AMAZON_URL.
 */
export const AMAZON_PRODUCT_URL =
  process.env.E2E_AMAZON_URL ?? "https://www.amazon.com/dp/B07FZ8S74R";

/**
 * A storefront that uses passwordless email-OTP login at checkout. The cleanest
 * exercise of the connected_otp path (less bot defense than a big retailer).
 * Override with a current product URL via E2E_OTP_SHOP_URL.
 */
export const OTP_SHOP_URL =
  process.env.E2E_OTP_SHOP_URL ?? "https://www.thursdayboots.com/products/mens-captain-black";

/**
 * A second major retailer (Best Buy by default; point at Target/Walmart/etc via
 * E2E_BIGBOX_URL). Exercises BOTH the user's connected account and a fresh agent
 * account on a site other than the canary — proves the paths are site-agnostic.
 */
export const BIGBOX_PRODUCT_URL =
  process.env.E2E_BIGBOX_URL ?? "https://www.bestbuy.com/site/apple-airtag/6588290.p";

export const TASKS = {
  /** Guest: explicit "as a guest" makes the resolver pick the guest strategy. */
  guest: `Buy this item and check out as a guest: ${GUEST_PRODUCT_URL}`,
  /** New account: nudges the resolver toward an agent identity + create_account gate. */
  newAccount: `Create an account and buy this item: ${NEW_ACCOUNT_PRODUCT_URL}`,
  /**
   * User account: book a flight on the user's Frontier account. "my Frontier
   * account" ties it to the user's records (connected-account login), and a
   * booking has a real payment page to park at (unlike check-in). Override the
   * itinerary via E2E_FRONTIER_TASK.
   */
  frontier:
    process.env.E2E_FRONTIER_TASK ??
    `Using my Frontier account, book a one-way Frontier flight from Denver (DEN) to Las Vegas (LAS) departing 2026-07-15 for one adult passenger at ${FRONTIER_URL}`,
  /**
   * Amazon, the user's own account. "my Amazon account" ties it to the user's
   * records → connected-account login (OTP when Gmail is connected, else session).
   */
  amazonUser:
    process.env.E2E_AMAZON_TASK ??
    `Reorder this item on my Amazon account: ${AMAZON_PRODUCT_URL}`,
  /**
   * Generic OTP storefront: explicitly sign in to the user's account, which
   * (with Gmail connected) routes to the email-OTP login path.
   */
  otpShop:
    process.env.E2E_OTP_SHOP_TASK ??
    `Log in to my account and buy this: ${OTP_SHOP_URL}`,
  /** Big-box retailer on the user's own account → connected-account login. */
  bigBoxUser:
    process.env.E2E_BIGBOX_USER_TASK ??
    `Buy this on my Best Buy account: ${BIGBOX_PRODUCT_URL}`,
  /** Big-box retailer with a fresh agent identity → agent login + create_account. */
  bigBoxAgent:
    process.env.E2E_BIGBOX_AGENT_TASK ??
    `Create an account and buy this item: ${BIGBOX_PRODUCT_URL}`,
} as const;
