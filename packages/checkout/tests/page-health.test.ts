import { describe, it, expect } from "vitest";
import { classifyPageHealth } from "../src/task.js";

describe("classifyPageHealth", () => {
  it("passes a real product/checkout page (substantial text + controls)", () => {
    const v = classifyPageHealth({ charCount: 65070, wordCount: 14179, visibleControls: 105 });
    expect(v.blocked).toBe(false);
    expect(v.reason).toBeUndefined();
  });

  it("blocks a minimal-content page (challenge wall / blank shell)", () => {
    const v = classifyPageHealth({ charCount: 120, wordCount: 18, visibleControls: 2 });
    expect(v.blocked).toBe(true);
    expect(v.reason).toMatch(/minimal content/);
  });

  it("blocks a page with text but zero actionable controls (collapsed render)", () => {
    // The aria-hidden over-pruning regression: text survived but every control was
    // removed. Such a page can't be driven — fail fast, don't burn the LLM budget.
    const v = classifyPageHealth({ charCount: 65070, wordCount: 14172, visibleControls: 0 });
    expect(v.blocked).toBe(true);
    expect(v.reason).toMatch(/no actionable controls/);
  });

  it("treats the word-count floor independently of char count", () => {
    const v = classifyPageHealth({ charCount: 800, wordCount: 12, visibleControls: 30 });
    expect(v.blocked).toBe(true);
  });
});
