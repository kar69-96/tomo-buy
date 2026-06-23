import { describe, it, expect } from "vitest";
import { verifyConfirmationPage } from "../src/confirm.js";

describe("verifyConfirmationPage", () => {
  it("detects positive confirmation page", () => {
    const text =
      "Thank you for your order! Your order number is #12345. You will receive a confirmation email shortly. Estimated delivery: 3-5 business days.";
    const result = verifyConfirmationPage(text);
    expect(result.isConfirmed).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects negative (checkout) page", () => {
    const text =
      "Enter your credit card number below. Payment method: Visa/Mastercard. Billing address required. Place order to complete purchase.";
    const result = verifyConfirmationPage(text);
    expect(result.isConfirmed).toBe(false);
  });

  it("negative wins when signals are tied", () => {
    const text =
      "Thank you! Enter your card number to place order. Order summary shown below.";
    const result = verifyConfirmationPage(text);
    // "thank you" + "order summary" = 2 positive, "card number" + "place order" = 2 negative
    // Tied means not confirmed (positive must strictly outnumber)
    expect(result.isConfirmed).toBe(false);
  });

  it("returns not confirmed for empty text", () => {
    const result = verifyConfirmationPage("");
    expect(result.isConfirmed).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("is case insensitive", () => {
    const text =
      "THANK YOU FOR YOUR ORDER! ORDER CONFIRMED. CONFIRMATION EMAIL SENT.";
    const result = verifyConfirmationPage(text);
    expect(result.isConfirmed).toBe(true);
  });

  it("high confidence with many positive signals", () => {
    const text =
      "Thank you! Order confirmed. Order number: #ABC-123. We received your order. Confirmation email sent. Estimated delivery: tomorrow.";
    const result = verifyConfirmationPage(text);
    expect(result.isConfirmed).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it("low confidence with single positive signal", () => {
    const text = "Thank you for visiting our page.";
    const result = verifyConfirmationPage(text);
    expect(result.isConfirmed).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });
});
