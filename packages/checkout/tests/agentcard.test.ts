import { describe, it, expect } from "vitest";
import {
  parseCardId,
  parseCardDetails,
  parse3dsCodes,
} from "../src/agentcard.js";

describe("parseCardId", () => {
  it("extracts a req_ id", () => {
    expect(parseCardId("Issued card. Request id: req_abc123XYZ ($18.00)")).toBe(
      "req_abc123XYZ",
    );
  });

  it("extracts a card_ id", () => {
    expect(parseCardId("New card card_9z8y7x created")).toBe("card_9z8y7x");
  });

  it("falls back to a generic prefix_token id", () => {
    expect(parseCardId("created crd_Ab12Cd34")).toBe("crd_Ab12Cd34");
  });

  it("returns null when no id present", () => {
    expect(parseCardId("no identifier here")).toBeNull();
  });
});

describe("parseCardDetails", () => {
  it("parses a labeled details block", () => {
    const out = [
      "Card details for req_abc123:",
      "  Cardholder: Jane Doe",
      "  Number: 4242 4242 4242 4242",
      "  Expiry: 12/29",
      "  CVV: 837",
    ].join("\n");
    const info = parseCardDetails(out);
    expect(info).not.toBeNull();
    expect(info!.number).toBe("4242424242424242");
    expect(info!.expiry).toBe("12/29");
    expect(info!.cvv).toBe("837");
    expect(info!.cardholder_name).toBe("Jane Doe");
  });

  it("handles dashed PAN and 4-digit cvc and 4-digit year", () => {
    const out = "PAN 4111-1111-1111-1111  exp 03/2030  CVC: 1234  Name on card: John Q Public";
    const info = parseCardDetails(out);
    expect(info!.number).toBe("4111111111111111");
    expect(info!.expiry).toBe("03/2030");
    expect(info!.cvv).toBe("1234");
    expect(info!.cardholder_name).toContain("John");
  });

  it("returns null without a plausible PAN", () => {
    expect(parseCardDetails("no card here, cvv 123")).toBeNull();
  });
});

describe("parse3dsCodes", () => {
  it("extracts and de-dups numeric codes", () => {
    const out = "Recent codes:\n- 123456 (2m ago)\n- 7788 (3m ago)\n- 123456 (dup)";
    expect(parse3dsCodes(out)).toEqual(["123456", "7788"]);
  });

  it("returns empty array when none", () => {
    expect(parse3dsCodes("No codes in the last 5 minutes.")).toEqual([]);
  });
});
