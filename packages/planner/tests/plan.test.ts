import { describe, it, expect, vi } from "vitest";

vi.mock("@tomo/identity", () => ({
  getOpenRouterKey: () => null, // force the deterministic fallback
  completeJson: vi.fn(),
}));

import { fallbackPlan, extractUrl, plan, reconcileSteps } from "../src/plan.js";
import type { ExecutionBrief, PlanStep } from "@tomo/core";

/** Minimal brief builder for reconcileSteps tests. */
function makeBrief(parameters: Record<string, string>): ExecutionBrief {
  return {
    objective: "buy the item",
    target: { site: "Shop", url: "https://shop.example/p/1", domain: "shop.example" },
    flow: "product",
    login: { required: false, type: "none" },
    parameters,
    constraints: [],
    execution_steps: [],
    resolve_live: [],
    grounding: { method: "test", candidates: [] },
  };
}

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

describe("reconcileSteps selection filtering", () => {
  const rawSteps: PlanStep[] = [
    { capability: "discover", args: { url: "https://shop.example/p/1" } },
    { capability: "purchase", args: { url: "https://shop.example/p/1" } },
  ];

  function purchaseSelections(brief: ExecutionBrief): Record<string, string> | undefined {
    const steps = reconcileSteps(rawSteps, brief, "buy https://shop.example/p/1");
    const purchase = steps.find((s) => s.capability === "purchase");
    return purchase?.args.selections as Record<string, string> | undefined;
  }

  it("drops product-identity keys that are not page variants", () => {
    const sel = purchaseSelections(
      makeBrief({ product_name: "Dijon Mustard", sku: "PK-123", brand: "Primal Kitchen" }),
    );
    // All identity keys filtered out → no selections at all.
    expect(sel).toBeUndefined();
  });

  it("keeps genuine variant keys like size and color", () => {
    const sel = purchaseSelections(
      makeBrief({ product_name: "Tee", size: "M", color: "blue" }),
    );
    expect(sel).toEqual({ size: "M", color: "blue" });
    expect(sel).not.toHaveProperty("product_name");
  });

  it("normalizes identity keys before matching (camelCase, spacing)", () => {
    const sel = purchaseSelections(
      makeBrief({ "Product Name": "X", productTitle: "Y", scent: "lavender" }),
    );
    expect(sel).toEqual({ scent: "lavender" });
  });

  it("drops a redundant default quantity of 1 (keeps the scripted fast path)", () => {
    // quantity:1 alone is a no-op → no selections → scripted Add-to-Cart.
    expect(purchaseSelections(makeBrief({ quantity: "1" }))).toBeUndefined();
  });

  it("keeps a real multi-buy quantity", () => {
    expect(purchaseSelections(makeBrief({ quantity: "2" }))).toEqual({ quantity: "2" });
  });
});
