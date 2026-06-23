import { describe, it, expect } from "vitest";
import { mapFieldToCredential } from "../src/fill.js";

describe("mapFieldToCredential — enhanced patterns", () => {
  // Original patterns still work
  it('maps "Card number input" to x_card_number', () => {
    expect(mapFieldToCredential("Card number input")).toBe("x_card_number");
  });

  it('maps "Expiration date" to x_card_expiry', () => {
    expect(mapFieldToCredential("Expiration date")).toBe("x_card_expiry");
  });

  // New patterns from hardening
  it('maps "credit card" to x_card_number', () => {
    expect(mapFieldToCredential("Enter your credit card")).toBe("x_card_number");
  });

  it('maps "exp date" to x_card_expiry', () => {
    expect(mapFieldToCredential("Exp date")).toBe("x_card_expiry");
  });

  it('maps "verification code" to x_card_cvv', () => {
    expect(mapFieldToCredential("Verification code")).toBe("x_card_cvv");
  });

  it('maps "card name" to x_cardholder_name', () => {
    expect(mapFieldToCredential("Card name")).toBe("x_cardholder_name");
  });

  // Split expiry fields
  it('maps "Exp month" to x_card_exp_month', () => {
    expect(mapFieldToCredential("Exp month")).toBe("x_card_exp_month");
  });

  it('maps "Expiry month" to x_card_exp_month', () => {
    expect(mapFieldToCredential("Expiry month")).toBe("x_card_exp_month");
  });

  it('maps "Exp year" to x_card_exp_year', () => {
    expect(mapFieldToCredential("Exp year")).toBe("x_card_exp_year");
  });

  it('maps "Expiry year" to x_card_exp_year', () => {
    expect(mapFieldToCredential("Expiry year")).toBe("x_card_exp_year");
  });

  // Non-card fields should still return null
  it("returns null for non-card fields", () => {
    expect(mapFieldToCredential("Email address")).toBeNull();
    expect(mapFieldToCredential("Phone number")).toBeNull();
    expect(mapFieldToCredential("ZIP code")).toBeNull();
  });
});
