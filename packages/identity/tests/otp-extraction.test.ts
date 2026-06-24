import { describe, it, expect } from "vitest";
import { extractCode } from "../src/agentmail.js";
import { extractMessages } from "../src/composio.js";

/**
 * OTP code extraction — exercised against the kinds of sentences real
 * verification emails use. The key property: a LABELED code wins over any
 * surrounding number (order id, year, total), so a 6-digit order id is never
 * mistaken for the one-time code. These bodies are synthetic — no real codes.
 */
describe("extractCode", () => {
  it("pulls a labeled numeric code", () => {
    expect(extractCode("Your verification code is 482913")).toBe("482913");
    expect(extractCode("Verification code: 558012")).toBe("558012");
    expect(extractCode("Enter code 123456 to continue")).toBe("123456");
    expect(extractCode("Your one-time passcode: 9087")).toBe("9087");
  });

  it("normalizes a code printed with spaces or hyphens", () => {
    expect(extractCode("Your code is 482 913")).toBe("482913");
    expect(extractCode("Verification code: 482-913")).toBe("482913");
  });

  it("prefers the labeled code over a surrounding order id / year / total", () => {
    const body =
      "Order #100234 placed in 2026. Your verification code is 558012. Total: 4299.";
    expect(extractCode(body)).toBe("558012");
  });

  it("does not capture a connector word as the code", () => {
    // The "is" after the label must not be captured as an alpha code.
    expect(extractCode("Your security code is 246810")).toBe("246810");
  });

  it("returns null when there is no code", () => {
    expect(extractCode("Welcome to the store! Thanks for signing up.")).toBeNull();
  });
});

/**
 * The GMAIL_FETCH_EMAILS envelope key varies by Composio toolkit version, so the
 * message list must be found under any of the known aliases AND one level of
 * nesting under an unknown wrapper key — generic over shape, never per-sender.
 */
describe("extractMessages", () => {
  it("finds the list under known top-level aliases", () => {
    expect(extractMessages({ messages: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(extractMessages({ emails: [{ id: "b" }] })).toEqual([{ id: "b" }]);
    expect(extractMessages({ results: [{ id: "c" }] })).toEqual([{ id: "c" }]);
  });

  it("unwraps one level of nesting under a wrapper key", () => {
    expect(extractMessages({ data: { messages: [{ id: "d" }] } })).toEqual([{ id: "d" }]);
    expect(extractMessages({ response_data: { emails: [{ id: "e" }] } })).toEqual([
      { id: "e" },
    ]);
  });

  it("returns an empty array when no list is present", () => {
    expect(extractMessages({})).toEqual([]);
    expect(extractMessages({ status: "ok", count: 0 })).toEqual([]);
  });
});
