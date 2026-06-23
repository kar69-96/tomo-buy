import { describe, it, expect } from "vitest";
import {
  isCardFieldIdent,
  isPaymentIframeSrc,
  filterPiiValues,
} from "../src/redact.js";

// These guard the prime-directive boundary: the screenshot redactor must cover
// every card/secret field and every payment iframe before a screenshot reaches
// the vision model. The in-page overlay code uses the same patterns.

describe("isCardFieldIdent", () => {
  it("matches card number / cvv / expiry / cardholder identifiers", () => {
    for (const ident of [
      "cardnumber",
      "card-number",
      "cc-number",
      "cardNum",
      "cvv",
      "cvc",
      "card_cvv",
      "security-code",
      "exp-date",
      "expiry",
      "cardholder",
      "card-holder",
      "cc-exp",
    ]) {
      expect(isCardFieldIdent(ident)).toBe(true);
    }
  });

  it("does not match ordinary, non-secret field identifiers", () => {
    for (const ident of ["email", "first-name", "address1", "city", "zip", "phone"]) {
      expect(isCardFieldIdent(ident)).toBe(false);
    }
  });
});

describe("isPaymentIframeSrc", () => {
  it("matches known payment-processor iframe srcs", () => {
    for (const src of [
      "https://js.stripe.com/v3/elements-inner-card.html",
      "https://assets.braintreegateway.com/...",
      "https://checkoutshopper-live.adyen.com/...",
      "https://checkout.com/framepay",
      "https://www.paypal.com/smart/buttons",
    ]) {
      expect(isPaymentIframeSrc(src)).toBe(true);
    }
  });

  it("does not match a benign same-origin iframe", () => {
    expect(isPaymentIframeSrc("https://merchant.example.com/embed/map")).toBe(false);
  });
});

describe("filterPiiValues", () => {
  it("keeps identifying values and drops short tokens / empties", () => {
    const out = filterPiiValues([
      "jane@example.com",
      "1600 Pennsylvania Ave",
      "US", // too short — would over-paint state/country selects
      "CA",
      "",
      "94105",
    ]);
    expect(out).toEqual(["jane@example.com", "1600 Pennsylvania Ave", "94105"]);
  });
});
