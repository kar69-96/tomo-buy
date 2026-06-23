/**
 * TDD: HTTP Walker integration tests (RED phase).
 *
 * Tests the full first-run checkout flow analysis pipeline:
 *   1. Fetch product page
 *   2. Detect platform
 *   3. Parse and classify pages
 *   4. Walk through checkout funnel
 *   5. Build site profile
 *
 * Requires BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, and
 * GOOGLE_API_KEY (Gemini) to be set.
 *
 * Tests run as dry-run (stops before real payment).
 */

import { describe, it, expect } from "vitest";
import { walkCheckoutFlow } from "../src/http-walker.js";
import type { ShippingInfo } from "@bloon/core";

const hasEnv =
  !!process.env.BROWSERBASE_API_KEY &&
  !!process.env.BROWSERBASE_PROJECT_ID &&
  (!!process.env.GOOGLE_API_KEY_QUERY || !!process.env.GOOGLE_API_KEY);

const testShipping: ShippingInfo = {
  name: "Test User",
  street: "123 Test St",
  city: "San Francisco",
  state: "CA",
  zip: "94107",
  country: "US",
  email: "test@example.com",
  phone: "4155551234",
};

describe.skipIf(!hasEnv)("walkCheckoutFlow — integration", () => {
  it("walks a Shopify store and produces a trace (dry-run)", async () => {
    const result = await walkCheckoutFlow({
      productUrl: "https://www.allbirds.com/products/mens-tree-runners",
      shipping: testShipping,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.trace).toBeDefined();
    expect(result.trace!.domain).toContain("allbirds.com");
    expect(result.trace!.platform).toBe("shopify");
    expect(result.trace!.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("detects platform correctly for a known Shopify store", async () => {
    const result = await walkCheckoutFlow({
      productUrl: "https://www.gymshark.com/products/mens-crest-t-shirt-black-aw24",
      shipping: testShipping,
      dryRun: true,
    });

    // Gymshark is heavily JS-rendered so HTTP walker may only get 1 step
    // (product page). The key test is platform detection, not full walk.
    expect(result.trace).toBeDefined();
    expect(result.trace!.platform).toBe("shopify");
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("handles a simple custom site gracefully", async () => {
    const result = await walkCheckoutFlow({
      productUrl: "https://www.target.com/p/apple-ipad-10-9-inch-10th-gen/-/A-77615850",
      shipping: testShipping,
      dryRun: true,
    });

    // Target may or may not fully succeed, but should not throw
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(1);
    if (result.trace) {
      expect(result.trace.steps.length).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  it("returns error for unreachable URL without throwing", async () => {
    const result = await walkCheckoutFlow({
      productUrl: "https://this-domain-definitely-does-not-exist-abc123.com/product",
      shipping: testShipping,
      dryRun: true,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.stepsCompleted).toBe(0);
  }, 30_000);
});
