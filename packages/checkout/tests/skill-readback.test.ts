import { describe, it, expect } from "vitest";
import { buildSelectorHints } from "../src/site-skill.js";
import type { SiteSkillRecord, RecordedSelector } from "../src/skill-types.js";

function record(selectors: RecordedSelector[]): SiteSkillRecord {
  return {
    domain: "example.com",
    version: 2,
    successCount: 2,
    createdAt: "2026-06-23T00:00:00.000Z",
    lastVerifiedAt: "2026-06-23T00:00:00.000Z",
    pageFlow: [],
    selectors,
    schema: 1,
  };
}

describe("read-back hints", () => {
  it("returns click selectors for a page type in recorded order (fresh-first)", () => {
    const hints = buildSelectorHints(
      record([
        { pageType: "product", action: "click-button", fieldLabel: "add to cart", matchedSelector: "#addNew", provenance: "STRUCTURAL", mode: "scripted" },
        { pageType: "product", action: "click-button", fieldLabel: "add to cart", matchedSelector: "#addOld", provenance: "STRUCTURAL", mode: "scripted" },
      ]),
    );
    expect(hints.forClick("product")).toEqual(["#addNew", "#addOld"]);
    expect(hints.forClick("cart")).toEqual([]);
  });

  it("excludes text= fallback descriptors from click hints", () => {
    const hints = buildSelectorHints(
      record([
        { pageType: "cart", action: "click-button", fieldLabel: "checkout", matchedSelector: "text=Checkout", provenance: "STRUCTURAL", mode: "scripted" },
      ]),
    );
    expect(hints.forClick("cart")).toEqual([]);
  });

  it("builds a fill-hints map keyed by field label", () => {
    const hints = buildSelectorHints(
      record([
        { pageType: "shipping-form", action: "fill-shipping", fieldLabel: "email", matchedSelector: 'input[type="email"]', provenance: "USER_INPUT", mode: "scripted" },
        { pageType: "shipping-form", action: "fill-shipping", fieldLabel: "city", matchedSelector: 'input[name="city"]', provenance: "USER_INPUT", mode: "scripted" },
        { pageType: "payment-form", action: "fill-card", fieldLabel: "card_number", matchedSelector: 'input[autocomplete="cc-number"]', provenance: "CDP_SECRET", mode: "scripted" },
      ]),
    );
    expect(hints.fillHintsFor("fill-shipping")).toEqual({
      email: ['input[type="email"]'],
      city: ['input[name="city"]'],
    });
    expect(hints.fillHintsFor("fill-card")).toEqual({
      card_number: ['input[autocomplete="cc-number"]'],
    });
  });

  it("is empty (and harmless) when there is no prior skill", () => {
    const hints = buildSelectorHints(null);
    expect(hints.isEmpty).toBe(true);
    expect(hints.forClick("product")).toEqual([]);
    expect(hints.fillHintsFor("fill-shipping")).toEqual({});
  });
});
