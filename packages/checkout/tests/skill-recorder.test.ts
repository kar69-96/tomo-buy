import { describe, it, expect } from "vitest";
import { SkillRecorder, dedupeSelectors, dedupeFlow } from "../src/skill-recorder.js";
import type { RecordedSelector, PageFlowEntry } from "../src/skill-types.js";

describe("SkillRecorder", () => {
  it("accumulates page flow and selectors", () => {
    const r = new SkillRecorder("example.com");
    r.observePage(0, "product", "https://example.com/p/123?ref=abc#frag");
    r.observePage(1, "cart", "https://example.com/cart");
    r.recordSelector({
      pageType: "product",
      action: "click-button",
      fieldLabel: "add to cart",
      matchedSelector: 'button[name="add"]',
      provenance: "STRUCTURAL",
    });
    const rec = r.finalize(new Date("2026-06-23T00:00:00Z"));

    expect(rec.domain).toBe("example.com");
    expect(rec.pageFlow).toHaveLength(2);
    // query + hash stripped to path only
    expect(rec.pageFlow[0].urlPath).toBe("/p/123");
    expect(rec.selectors).toHaveLength(1);
    expect(rec.selectors[0].mode).toBe("scripted");
    expect(rec.successCount).toBe(1);
    expect(rec.createdAt).toBe("2026-06-23T00:00:00.000Z");
  });

  it("defaults mode to scripted and honors explicit llm mode", () => {
    const r = new SkillRecorder("a.com");
    r.recordSelector({
      pageType: "shipping-form", action: "fill-shipping",
      fieldLabel: "email", matchedSelector: 'input[type="email"]', provenance: "USER_INPUT",
    });
    r.recordSelector({
      pageType: "shipping-form", action: "fill-shipping",
      fieldLabel: "city", matchedSelector: 'input[name="city"]', provenance: "USER_INPUT",
    }, "llm");
    const rec = r.finalize();
    expect(rec.selectors[0].mode).toBe("scripted");
    expect(rec.selectors[1].mode).toBe("llm");
  });

  it("finalize returns a frozen object", () => {
    const r = new SkillRecorder("a.com");
    const rec = r.finalize();
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it("empty recorder yields zero selectors", () => {
    const r = new SkillRecorder("a.com");
    expect(r.selectorCount).toBe(0);
    expect(r.finalize().selectors).toHaveLength(0);
  });

  it("selectorCount tracks recorded selectors", () => {
    const r = new SkillRecorder("a.com");
    r.recordSelector({
      pageType: "cart", action: "click-button",
      fieldLabel: "checkout", matchedSelector: "#checkout", provenance: "STRUCTURAL",
    });
    expect(r.selectorCount).toBe(1);
  });
});

describe("dedupeSelectors", () => {
  it("dedupes on pageType+action+fieldLabel+selector", () => {
    const dup: RecordedSelector = {
      pageType: "cart", action: "click-button",
      fieldLabel: "checkout", matchedSelector: "#checkout",
      provenance: "STRUCTURAL", mode: "scripted",
    };
    const out = dedupeSelectors([dup, { ...dup }, { ...dup, matchedSelector: "#go" }]);
    expect(out).toHaveLength(2);
  });
});

describe("dedupeFlow", () => {
  it("collapses consecutive identical entries", () => {
    const flow: PageFlowEntry[] = [
      { index: 0, pageType: "product", urlPath: "/p" },
      { index: 1, pageType: "product", urlPath: "/p" },
      { index: 2, pageType: "cart", urlPath: "/cart" },
    ];
    expect(dedupeFlow(flow)).toHaveLength(2);
  });
});
