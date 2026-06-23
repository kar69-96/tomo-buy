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
} as const;
