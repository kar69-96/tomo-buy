import { describe, it, expect } from "vitest";
import type { CheckoutResult, CheckoutCheckpoints } from "../src/task.js";
import type { CheckoutErrorCategory } from "@bloon/core";

describe("CheckoutResult type shape", () => {
  it("supports all new fields from hardening", () => {
    const result: CheckoutResult = {
      success: false,
      sessionId: "test-session-123",
      replayUrl: "https://browserbase.com/sessions/test-session-123",
      failedStep: "fill-shipping",
      errorMessage: "No shipping fields found",
      errorCategory: "form_fill_failed",
      diagnosticScreenshotPath: "/home/user/.bloon/diagnostics/test-session-123.png",
      checkpoints: {
        cart: "https://example.com/cart",
        shipping: "https://example.com/checkout/shipping",
      },
      durationMs: 45000,
    };

    expect(result.errorCategory).toBe("form_fill_failed");
    expect(result.diagnosticScreenshotPath).toContain(".png");
    expect(result.checkpoints?.cart).toBeTruthy();
    expect(result.checkpoints?.shipping).toBeTruthy();
  });

  it("supports successful result without error fields", () => {
    const result: CheckoutResult = {
      success: true,
      orderNumber: "ORD-12345",
      finalTotal: "29.99",
      sessionId: "test-session-456",
      replayUrl: "https://browserbase.com/sessions/test-session-456",
      checkpoints: {
        cart: "https://example.com/cart",
        shipping: "https://example.com/checkout/shipping",
        payment: "https://example.com/checkout/payment",
        confirmation: "https://example.com/confirmation/ORD-12345",
      },
      durationMs: 120000,
    };

    expect(result.success).toBe(true);
    expect(result.errorCategory).toBeUndefined();
    expect(result.diagnosticScreenshotPath).toBeUndefined();
    expect(result.checkpoints?.confirmation).toBeTruthy();
  });
});

describe("CheckoutErrorCategory exhaustiveness", () => {
  it("covers all 7 error categories", () => {
    const categories: CheckoutErrorCategory[] = [
      "bot_detected",
      "form_fill_failed",
      "payment_rejected",
      "navigation_failed",
      "captcha_unsolved",
      "session_timeout",
      "unknown",
    ];
    expect(categories).toHaveLength(7);
    // Verify each is a valid string (TypeScript ensures type safety at compile time)
    for (const cat of categories) {
      expect(typeof cat).toBe("string");
      expect(cat.length).toBeGreaterThan(0);
    }
  });
});

describe("CheckoutCheckpoints type shape", () => {
  it("supports all checkpoint stages", () => {
    const checkpoints: CheckoutCheckpoints = {
      cart: "https://example.com/cart",
      shipping: "https://example.com/checkout/shipping",
      payment: "https://example.com/checkout/payment",
      confirmation: "https://example.com/confirmation",
    };

    expect(Object.keys(checkpoints)).toHaveLength(4);
  });

  it("allows partial checkpoints (not all stages reached)", () => {
    const checkpoints: CheckoutCheckpoints = {
      cart: "https://example.com/cart",
    };

    expect(checkpoints.cart).toBeTruthy();
    expect(checkpoints.shipping).toBeUndefined();
    expect(checkpoints.payment).toBeUndefined();
    expect(checkpoints.confirmation).toBeUndefined();
  });
});
