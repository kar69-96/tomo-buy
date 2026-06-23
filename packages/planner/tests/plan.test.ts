import { describe, it, expect, vi } from "vitest";

vi.mock("@tomo/identity", () => ({
  getOpenRouterKey: () => null, // force the deterministic fallback
  completeJson: vi.fn(),
}));

import { fallbackPlan, extractUrl, plan } from "../src/plan.js";

describe("extractUrl", () => {
  it("pulls a url out of a task and strips trailing punctuation", () => {
    expect(extractUrl("please buy https://shop.example/p/1.")).toBe(
      "https://shop.example/p/1",
    );
    expect(extractUrl("buy some sneakers")).toBeNull();
  });
});

describe("fallbackPlan", () => {
  it("plans discover -> login -> purchase for a URL", () => {
    const p = fallbackPlan("buy https://shop.example/p/1");
    expect(p.steps.map((s) => s.capability)).toEqual([
      "discover",
      "login",
      "purchase",
    ]);
    expect(p.steps[1]!.args.domain).toBe("shop.example");
    expect(p.steps[2]!.gate).toBe("purchase_confirm");
  });

  it("plans a single discover step for a natural-language request", () => {
    const p = fallbackPlan("find me blue running shoes");
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]!.capability).toBe("discover");
    expect(p.steps[0]!.args.query).toBe("find me blue running shoes");
  });
});

describe("plan", () => {
  it("uses the fallback when no LLM key is configured", async () => {
    const p = await plan("buy https://shop.example/p/2");
    expect(p.steps[2]!.capability).toBe("purchase");
  });
});
