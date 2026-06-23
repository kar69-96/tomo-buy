import { describe, it, expect } from "vitest";
import { classifyError, detectCheckoutPhase, isShopifyCheckout } from "../src/task.js";

describe("classifyError", () => {
  it("classifies bot detection from error message", () => {
    expect(classifyError("access denied", "")).toBe("bot_detected");
    expect(classifyError("automated browser detected", "")).toBe("bot_detected");
  });

  it("classifies bot detection from page text", () => {
    expect(classifyError("unknown error", "Access Denied - You don't have permission")).toBe("bot_detected");
    expect(classifyError("step failed", "automated access to this page is not allowed")).toBe("bot_detected");
  });

  it("classifies CAPTCHA unsolved", () => {
    expect(classifyError("captcha timeout", "")).toBe("captcha_unsolved");
    expect(classifyError("challenge not resolved", "")).toBe("captcha_unsolved");
  });

  it("classifies navigation failures", () => {
    expect(classifyError("Navigation timeout exceeded", "")).toBe("navigation_failed");
    expect(classifyError("net::ERR_CONNECTION_REFUSED", "")).toBe("navigation_failed");
    expect(classifyError("ECONNREFUSED", "")).toBe("navigation_failed");
  });

  it("classifies payment rejection", () => {
    expect(classifyError("card declined", "")).toBe("payment_rejected");
    expect(classifyError("", "Your card was declined")).toBe("payment_rejected");
    expect(classifyError("", "payment could not be processed")).toBe("payment_rejected");
  });

  it("classifies form fill failures", () => {
    expect(classifyError("No card fields found", "")).toBe("form_fill_failed");
    expect(classifyError("No shipping fields found on this page", "")).toBe("form_fill_failed");
    expect(classifyError("Failed to fill card fields", "")).toBe("form_fill_failed");
  });

  it("classifies session timeout", () => {
    expect(classifyError("session expired", "")).toBe("session_timeout");
    expect(classifyError("max steps exceeded", "")).toBe("session_timeout");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(classifyError("something weird happened", "normal page content")).toBe("unknown");
  });

  it("prioritizes bot_detected over other classifications", () => {
    // Error message has "access denied" (bot) and page has "card" (could be form)
    expect(classifyError("access denied to checkout", "")).toBe("bot_detected");
  });
});

describe("detectCheckoutPhase", () => {
  it("detects cart phase", () => {
    expect(detectCheckoutPhase("https://example.com/cart", false)).toBe("cart");
    expect(detectCheckoutPhase("https://example.com/bag", false)).toBe("cart");
  });

  it("detects shipping phase from URL", () => {
    expect(detectCheckoutPhase("https://example.com/checkout", false)).toBe("shipping");
    expect(detectCheckoutPhase("https://example.com/checkouts/abc123", false)).toBe("shipping");
  });

  it("detects delivery phase", () => {
    expect(detectCheckoutPhase("https://example.com/delivery", false)).toBe("delivery");
    expect(detectCheckoutPhase("https://example.com/shipping-method", false)).toBe("delivery");
  });

  it("detects payment phase from URL", () => {
    expect(detectCheckoutPhase("https://example.com/payment", false)).toBe("payment");
    expect(detectCheckoutPhase("https://example.com/billing", false)).toBe("payment");
  });

  it("detects payment phase when card fields are present", () => {
    expect(detectCheckoutPhase("https://example.com/checkout/step-3", true)).toBe("payment");
  });

  it("detects review phase", () => {
    expect(detectCheckoutPhase("https://example.com/review", false)).toBe("review");
    expect(detectCheckoutPhase("https://example.com/order-review", false)).toBe("review");
  });

  it("detects confirmation phase", () => {
    expect(detectCheckoutPhase("https://example.com/confirmation", false)).toBe("confirmation");
    expect(detectCheckoutPhase("https://example.com/thank-you", false)).toBe("confirmation");
  });

  it("defaults to shipping for ambiguous checkout URLs", () => {
    expect(detectCheckoutPhase("https://example.com/checkout/info", false)).toBe("shipping");
  });
});

describe("isShopifyCheckout", () => {
  it("detects Shopify checkout URLs", () => {
    expect(isShopifyCheckout("https://shop.example.com/checkouts/abc123")).toBe(true);
    expect(isShopifyCheckout("https://store.myshopify.com/products/abc")).toBe(true);
  });

  it("returns false for non-Shopify URLs", () => {
    expect(isShopifyCheckout("https://www.target.com/checkout")).toBe(false);
    expect(isShopifyCheckout("https://www.bestbuy.com/checkout/payment")).toBe(false);
  });
});
