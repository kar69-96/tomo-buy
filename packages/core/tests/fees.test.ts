import { describe, it, expect } from "vitest";
import { calculateFee, calculateTotal } from "../src/fees.js";

describe("calculateFee", () => {
  it('fee for $17.99 rounds up to "0.36"', () => {
    // 17.99 * 0.02 = 0.3598, ceil to 2dp = 0.36
    expect(calculateFee("17.99")).toBe("0.36");
  });

  it('fee for $0.10 returns exact "0.002"', () => {
    // 0.10 * 0.02 = 0.002, < 0.01, exact
    expect(calculateFee("0.10")).toBe("0.002");
  });

  it('fee for $10.00 is "0.20"', () => {
    // 10.00 * 0.02 = 0.20, exact at 2dp
    expect(calculateFee("10.00")).toBe("0.20");
  });

  it('fee for $1.00 is "0.02"', () => {
    // 1.00 * 0.02 = 0.02, >= 0.01, round to 2dp = 0.02
    expect(calculateFee("1.00")).toBe("0.02");
  });

  it('fee for $20.00 is "0.40"', () => {
    // 20.00 * 0.02 = 0.40, >= 0.01, round to 2dp = 0.40
    expect(calculateFee("20.00")).toBe("0.40");
  });

  it('fee for $100.00 is "2.00"', () => {
    // 100.00 * 0.02 = 2.00
    expect(calculateFee("100.00")).toBe("2.00");
  });
});

describe("calculateTotal", () => {
  it('total for $17.99 is "18.35"', () => {
    // 17.99 + 0.36 = 18.35
    expect(calculateTotal("17.99")).toBe("18.35");
  });

  it('total for $0.10 is "0.102"', () => {
    // 0.10 + 0.002 = 0.102
    expect(calculateTotal("0.10")).toBe("0.102");
  });

  it('total for $100.00 is "102.00"', () => {
    // No price cap anymore
    expect(calculateTotal("100.00")).toBe("102");
  });
});
