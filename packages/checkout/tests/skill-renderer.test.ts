import { describe, it, expect } from "vitest";
import { renderSkillMarkdown } from "../src/skill-renderer.js";
import type { SiteSkillRecord, RecordedSelector } from "../src/skill-types.js";

function rec(partial: Partial<SiteSkillRecord> = {}): SiteSkillRecord {
  return {
    domain: "shop.example.com",
    version: 1,
    successCount: 1,
    createdAt: "2026-06-23T00:00:00.000Z",
    lastVerifiedAt: "2026-06-23T00:00:00.000Z",
    pageFlow: [
      { index: 0, pageType: "product", urlPath: "/p/1" },
      { index: 1, pageType: "shipping-form", urlPath: "/checkout" },
      { index: 2, pageType: "payment-form", urlPath: "/checkout/pay" },
      { index: 3, pageType: "confirmation", urlPath: "/thank-you" },
    ],
    selectors: [],
    schema: 1,
    ...partial,
  };
}

const SELECTORS: RecordedSelector[] = [
  {
    pageType: "product", action: "click-button", fieldLabel: "add to cart",
    matchedSelector: 'button[name="add"]', provenance: "STRUCTURAL", mode: "scripted",
  },
  {
    pageType: "payment-form", action: "fill-card", fieldLabel: "card_number",
    matchedSelector: 'input[autocomplete="cc-number"]', provenance: "CDP_SECRET", mode: "scripted",
  },
  {
    pageType: "shipping-form", action: "fill-shipping", fieldLabel: "email",
    matchedSelector: 'input[type="email"]', provenance: "USER_INPUT", mode: "scripted",
  },
  {
    pageType: "shipping-form", action: "select-option", fieldLabel: "express shipping",
    matchedSelector: '[role="radio"]', provenance: "SELECTION", mode: "scripted",
  },
];

describe("renderSkillMarkdown", () => {
  it("puts STRUCTURAL+CDP_SECRET in Fixed and USER_INPUT+SELECTION in Variable", () => {
    const md = renderSkillMarkdown(rec({ selectors: SELECTORS }));
    const fixedSection = md.slice(md.indexOf("### Fixed"), md.indexOf("### Variable"));
    const variableSection = md.slice(md.indexOf("### Variable"), md.indexOf("## Learnings"));

    expect(fixedSection).toContain("add to cart");
    expect(fixedSection).toContain("card_number");
    expect(fixedSection).not.toContain("express shipping");

    expect(variableSection).toContain("email");
    expect(variableSection).toContain("express shipping");
    expect(variableSection).not.toContain("add to cart");
  });

  it("renders the page flow chain in order", () => {
    const md = renderSkillMarkdown(rec({ selectors: SELECTORS }));
    expect(md).toContain("product → shipping-form → payment-form → confirmation");
  });

  it("shows a placeholder when learnings are missing and the prose when present", () => {
    expect(renderSkillMarkdown(rec())).toContain("_No narration available for this run._");
    const withProse = renderSkillMarkdown(rec({ learnings: "Watch for the cookie banner." }));
    expect(withProse).toContain("Watch for the cookie banner.");
  });

  it("never emits a card-number-shaped digit run (no value column)", () => {
    // Even when labels are secret field names, the output carries no values.
    const md = renderSkillMarkdown(rec({ selectors: SELECTORS }));
    expect(md).not.toMatch(/\d{13,19}/);
  });
});
