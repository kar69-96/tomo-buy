import { describe, it, expect } from "vitest";
import { formatPhone } from "../src/credentials.js";

describe("formatPhone", () => {
  it("formats US 10-digit phone as (xxx) xxx-xxxx", () => {
    expect(formatPhone("5035550100", "US")).toBe("(503) 555-0100");
  });

  it("formats US 11-digit phone (with leading 1)", () => {
    expect(formatPhone("15035550100", "US")).toBe("(503) 555-0100");
  });

  it("formats CA 10-digit phone as (xxx) xxx-xxxx", () => {
    expect(formatPhone("4165550100", "CA")).toBe("(416) 555-0100");
  });

  it("strips non-digit characters before formatting", () => {
    expect(formatPhone("(503) 555-0100", "US")).toBe("(503) 555-0100");
    expect(formatPhone("503.555.0100", "US")).toBe("(503) 555-0100");
    expect(formatPhone("+1-503-555-0100", "US")).toBe("(503) 555-0100");
  });

  it("returns raw digits for non-US/CA countries", () => {
    expect(formatPhone("+44 20 7946 0958", "GB")).toBe("442079460958");
  });

  it("returns raw digits when US phone has wrong digit count", () => {
    expect(formatPhone("12345", "US")).toBe("12345");
    expect(formatPhone("123456789012", "US")).toBe("123456789012");
  });

  it("handles empty string", () => {
    expect(formatPhone("", "US")).toBe("");
  });

  it("is case-insensitive for country code", () => {
    expect(formatPhone("5035550100", "us")).toBe("(503) 555-0100");
    expect(formatPhone("5035550100", "Us")).toBe("(503) 555-0100");
  });
});
