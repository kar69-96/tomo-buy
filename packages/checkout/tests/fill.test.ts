import { describe, it, expect } from "vitest";
import { mapFieldToCredential } from "../src/fill.js";

describe("mapFieldToCredential", () => {
  it('maps "Card number input" to x_card_number', () => {
    expect(mapFieldToCredential("Card number input")).toBe("x_card_number");
  });

  it('maps "card number" to x_card_number', () => {
    expect(mapFieldToCredential("card number")).toBe("x_card_number");
  });

  it('maps "Expiration date" to x_card_expiry', () => {
    expect(mapFieldToCredential("Expiration date")).toBe("x_card_expiry");
  });

  it('maps "Expiry" to x_card_expiry', () => {
    expect(mapFieldToCredential("Expiry")).toBe("x_card_expiry");
  });

  it('maps "CVV" to x_card_cvv', () => {
    expect(mapFieldToCredential("CVV")).toBe("x_card_cvv");
  });

  it('maps "CVC / Security code" to x_card_cvv', () => {
    expect(mapFieldToCredential("CVC / Security code")).toBe("x_card_cvv");
  });

  it('maps "Cardholder name" to x_cardholder_name', () => {
    expect(mapFieldToCredential("Cardholder name")).toBe("x_cardholder_name");
  });

  it('maps "Name on card" to x_cardholder_name', () => {
    expect(mapFieldToCredential("Name on card")).toBe("x_cardholder_name");
  });

  it("returns null for non-card fields", () => {
    expect(mapFieldToCredential("Email address")).toBeNull();
    expect(mapFieldToCredential("Phone number")).toBeNull();
    expect(mapFieldToCredential("Shipping address")).toBeNull();
  });
});
