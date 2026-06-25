import { describe, it, expect } from "vitest";
import { advanced, normalizeSteps } from "../src/act.js";
import type { PageSignature } from "../src/act.js";

const base: PageSignature = {
  url: "https://x.test/",
  title: "X",
  elCount: 1000,
  visInputs: 4,
  visDialogs: 0,
};

describe("advanced() — page-advancement signal", () => {
  it("true on navigation", () => {
    expect(advanced(base, { ...base, url: "https://x.test/next" })).toBe(true);
  });
  it("true on title change", () => {
    expect(advanced(base, { ...base, title: "Account" })).toBe(true);
  });
  it("true when a dialog/modal appears", () => {
    expect(advanced(base, { ...base, visDialogs: 1 })).toBe(true);
  });
  it("true when a real form reveals (>=2 new inputs)", () => {
    expect(advanced(base, { ...base, visInputs: 6 })).toBe(true);
  });
  it("true on a substantial DOM addition (>=40 nodes)", () => {
    expect(advanced(base, { ...base, elCount: 1100 })).toBe(true);
  });
  it("FALSE on ambient churn — one stray input / small element delta", () => {
    expect(advanced(base, { ...base, visInputs: 5, elCount: 1010 })).toBe(false);
  });
  it("FALSE on a small element DECREASE (ticker re-render)", () => {
    expect(advanced(base, { ...base, elCount: 986 })).toBe(false);
  });
  it("FALSE on an identical signature", () => {
    expect(advanced(base, { ...base })).toBe(false);
  });
});

describe("normalizeSteps() — accepts the press primitive", () => {
  it("keeps a press step with a key value", () => {
    const steps = normalizeSteps({ steps: [{ action: "press", value: "Enter" }] });
    expect(steps).toEqual([{ action: "press", value: "Enter" }]);
  });
  it("normalizes a bare inline press step", () => {
    expect(normalizeSteps({ action: "press", value: "Escape" })).toEqual([
      { action: "press", value: "Escape" },
    ]);
  });
});
