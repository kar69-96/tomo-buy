import { describe, it, expect } from "vitest";
import { mergeSiteSkill, buildSelectorHints } from "../src/site-skill.js";
import type { SiteSkillRecord, RecordedSelector } from "../src/skill-types.js";

function selector(over: Partial<RecordedSelector> = {}): RecordedSelector {
  return {
    pageType: "product",
    action: "click-button",
    fieldLabel: "add to cart",
    matchedSelector: 'button[name="add"]',
    provenance: "STRUCTURAL",
    mode: "scripted",
    ...over,
  };
}

function record(over: Partial<SiteSkillRecord> = {}): SiteSkillRecord {
  return {
    domain: "example.com",
    version: 1,
    successCount: 1,
    createdAt: "2026-06-23T00:00:00.000Z",
    lastVerifiedAt: "2026-06-23T00:00:00.000Z",
    pageFlow: [{ index: 0, pageType: "product", urlPath: "/p" }],
    selectors: [selector()],
    schema: 1,
    ...over,
  };
}

describe("mergeSiteSkill", () => {
  it("returns the fresh record when there is no existing one", () => {
    const fresh = record();
    expect(mergeSiteSkill(null, fresh)).toBe(fresh);
  });

  it("increments version and successCount", () => {
    const existing = record({ version: 3, successCount: 5 });
    const fresh = record({ lastVerifiedAt: "2026-07-01T00:00:00.000Z" });
    const merged = mergeSiteSkill(existing, fresh);
    expect(merged.version).toBe(4);
    expect(merged.successCount).toBe(6);
    expect(merged.lastVerifiedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("unions selectors so A/B variants both survive", () => {
    const existing = record({ selectors: [selector({ matchedSelector: "#addA" })] });
    const fresh = record({ selectors: [selector({ matchedSelector: "#addB" })] });
    const merged = mergeSiteSkill(existing, fresh);
    const selectors = merged.selectors.map((s) => s.matchedSelector).sort();
    expect(selectors).toEqual(["#addA", "#addB"]);
  });

  it("keeps prior learnings when the fresh narration is absent", () => {
    const existing = record({ learnings: "Old wisdom." });
    const fresh = record({ learnings: undefined });
    expect(mergeSiteSkill(existing, fresh).learnings).toBe("Old wisdom.");
  });

  it("prefers the longer/newer page flow", () => {
    const existing = record({ pageFlow: [{ index: 0, pageType: "product", urlPath: "/p" }] });
    const fresh = record({
      pageFlow: [
        { index: 0, pageType: "product", urlPath: "/p" },
        { index: 1, pageType: "cart", urlPath: "/c" },
      ],
    });
    expect(mergeSiteSkill(existing, fresh).pageFlow).toHaveLength(2);
  });

  it("does not mutate the existing record", () => {
    const existing = record({ version: 1, successCount: 1 });
    const before = JSON.stringify(existing);
    mergeSiteSkill(existing, record({ selectors: [selector({ matchedSelector: "#new" })] }));
    expect(JSON.stringify(existing)).toBe(before);
  });
});

describe("buildSelectorHints", () => {
  it("groups click selectors by page type and excludes text= fallbacks", () => {
    const hints = buildSelectorHints(
      record({
        selectors: [
          selector({ pageType: "cart", matchedSelector: "#checkout" }),
          selector({ pageType: "cart", matchedSelector: "text=Checkout" }),
          selector({ pageType: "product", matchedSelector: "#add" }),
        ],
      }),
    );
    expect(hints.forClick("cart")).toEqual(["#checkout"]);
    expect(hints.forClick("product")).toEqual(["#add"]);
  });

  it("groups fill selectors by action+field", () => {
    const hints = buildSelectorHints(
      record({
        selectors: [
          selector({
            action: "fill-shipping", fieldLabel: "email",
            matchedSelector: 'input[type="email"]', provenance: "USER_INPUT",
          }),
        ],
      }),
    );
    expect(hints.forFill("fill-shipping", "email")).toEqual(['input[type="email"]']);
  });

  it("is empty for a null record", () => {
    expect(buildSelectorHints(null).isEmpty).toBe(true);
  });
});
