import { describe, it, expect } from "vitest";
import { normalizeSteps } from "../src/act.js";

/**
 * normalizeSteps is the parse-robustness layer that turns a variety of model
 * response shapes into a usable step list. Weaker vision models frequently return a
 * bare array or wrap the steps under an alternate key — a strict `parsed.steps` read
 * silently dropped those (→ a phantom no-op that stalled the whole checkout loop).
 */
describe("normalizeSteps", () => {
  it("accepts the canonical {steps:[...]} shape", () => {
    const out = normalizeSteps({ steps: [{ action: "click", ref: 3 }] });
    expect(out).toEqual([{ action: "click", ref: 3 }]);
  });

  it("accepts a bare array of steps", () => {
    const out = normalizeSteps([{ action: "scroll", value: "down" }]);
    expect(out).toEqual([{ action: "scroll", value: "down" }]);
  });

  it("accepts an alternate 'actions' key", () => {
    const out = normalizeSteps({ actions: [{ action: "fill", ref: 1, var: "x_shipping_email" }] });
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe("fill");
  });

  it("accepts an alternate 'step' key", () => {
    const out = normalizeSteps({ step: [{ action: "click", ref: 5 }] });
    expect(out).toEqual([{ action: "click", ref: 5 }]);
  });

  it("wraps a single inline step object", () => {
    const out = normalizeSteps({ action: "click", ref: 7 });
    expect(out).toEqual([{ action: "click", ref: 7 }]);
  });

  it("wraps a single step nested under a wrapper key", () => {
    const out = normalizeSteps({ steps: { action: "click", ref: 2 } });
    expect(out).toEqual([{ action: "click", ref: 2 }]);
  });

  it("returns [] for empty/garbage shapes (genuine no-op)", () => {
    expect(normalizeSteps({ steps: [] })).toEqual([]);
    expect(normalizeSteps({})).toEqual([]);
    expect(normalizeSteps(null)).toEqual([]);
    expect(normalizeSteps("nope")).toEqual([]);
    expect(normalizeSteps(42)).toEqual([]);
  });
});
