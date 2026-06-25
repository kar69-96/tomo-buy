import { describe, it, expect } from "vitest";
import { TomoError, ErrorCodes } from "@tomo/core";
import { normalizePrice, normalizePriceOrThrow } from "../src/discover.js";

describe("normalizePrice — format handling", () => {
  it("US/standard '$49.99' -> '49.99'", () => {
    expect(normalizePrice("$49.99")).toBe("49.99");
  });

  it("plain '49.99' -> '49.99'", () => {
    expect(normalizePrice("49.99")).toBe("49.99");
  });

  it("EU decimal comma '49,99' -> '49.99'", () => {
    expect(normalizePrice("49,99")).toBe("49.99");
  });

  it("US thousands '1,234.56' -> '1234.56'", () => {
    expect(normalizePrice("1,234.56")).toBe("1234.56");
  });

  it("EU thousands '1.234,56' -> '1234.56'", () => {
    expect(normalizePrice("1.234,56")).toBe("1234.56");
  });

  it("EU thousands with currency '€ 1.234,56' -> '1234.56'", () => {
    expect(normalizePrice("€ 1.234,56")).toBe("1234.56");
  });

  it("integer dollars '4999' (no separators) -> '4999.00', NOT cents", () => {
    expect(normalizePrice("4999")).toBe("4999.00");
  });

  it("integer with currency symbol '$34' -> '34.00'", () => {
    expect(normalizePrice("$34")).toBe("34.00");
  });

  it("EU multi-dot thousands '1.234.567' -> '1234567.00'", () => {
    expect(normalizePrice("1.234.567")).toBe("1234567.00");
  });

  it("US thousands without decimals '1,234' -> '1234.00'", () => {
    expect(normalizePrice("1,234")).toBe("1234.00");
  });

  it("trims surrounding text 'Now $49.99 USD' -> '49.99'", () => {
    expect(normalizePrice("Now $49.99 USD")).toBe("49.99");
  });

  it("accepts a numeric input 49.99 -> '49.99'", () => {
    expect(normalizePrice(49.99)).toBe("49.99");
  });
});

describe("normalizePrice — failing run fixtures (regression guards)", () => {
  // Run failure: "Price mismatch: expected ~$4999, found $49.99" (3x).
  // The LLM had returned "4999" for a $49.99 item (decimal point stripped).
  // The fix is the prompt change; here we guard that a real decimal price
  // never gets collapsed into "4999" by the normalizer.
  it("a genuine '$49.99' must NOT become '4999'", () => {
    const result = normalizePrice("$49.99");
    expect(result).toBe("49.99");
    expect(result).not.toBe("4999");
    expect(result).not.toBe("4999.00");
  });

  // Run failure: "Price mismatch: expected ~$34, found $0.00" (1x).
  // A non-empty raw string that resolves to zero is an extraction failure,
  // not a silent free item.
  it("input that resolves to zero from non-empty raw -> null (no silent '0.00')", () => {
    expect(normalizePrice("0")).toBeNull();
    expect(normalizePrice("$0.00")).toBeNull();
    expect(normalizePrice("free")).toBeNull();
    expect(normalizePrice("0,00")).toBeNull();
  });
});

describe("normalizePrice — empty / invalid input", () => {
  it("returns null for null/undefined/empty", () => {
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
    expect(normalizePrice("")).toBeNull();
    expect(normalizePrice("   ")).toBeNull();
  });

  it("returns null for non-numeric text", () => {
    expect(normalizePrice("contact us for pricing")).toBeNull();
  });
});

describe("normalizePrice — explicit cents unit", () => {
  it("treats integer cents as cents only when told to", () => {
    expect(normalizePrice("4999", { unit: "cents" })).toBe("49.99");
    expect(normalizePrice("3400", { unit: "cents" })).toBe("34.00");
  });

  it("defaults to dollars (major units) for the same input", () => {
    expect(normalizePrice("4999")).toBe("4999.00");
  });
});

describe("normalizePriceOrThrow", () => {
  it("returns the normalized price on success", () => {
    expect(normalizePriceOrThrow("$49.99")).toBe("49.99");
  });

  it("throws PRICE_EXTRACTION_FAILED on unparseable input", () => {
    expect(() => normalizePriceOrThrow("free")).toThrow(TomoError);
    try {
      normalizePriceOrThrow("free");
    } catch (e) {
      expect((e as TomoError).code).toBe(ErrorCodes.PRICE_EXTRACTION_FAILED);
    }
  });

  it("does not mutate its input", () => {
    const input = "$1,234.56";
    normalizePriceOrThrow(input);
    expect(input).toBe("$1,234.56");
  });
});
