import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM wrapper so no real network call happens and we can force failures.
const completePromptMock = vi.fn();
vi.mock("../src/llm.js", () => ({
  completePrompt: (...args: unknown[]) => completePromptMock(...args),
}));

import { buildNarrationFacts, narrateLearnings } from "../src/skill-narrator.js";
import type { SiteSkillRecord } from "../src/skill-types.js";

// A record whose field labels are the secret field NAMES — the values must never appear.
const record: SiteSkillRecord = {
  domain: "shop.example.com",
  version: 1,
  successCount: 1,
  createdAt: "2026-06-23T00:00:00.000Z",
  lastVerifiedAt: "2026-06-23T00:00:00.000Z",
  pageFlow: [
    { index: 0, pageType: "payment-form", urlPath: "/checkout/pay" },
  ],
  selectors: [
    {
      pageType: "payment-form", action: "fill-card", fieldLabel: "card_number",
      matchedSelector: 'input[autocomplete="cc-number"]', provenance: "CDP_SECRET", mode: "scripted",
    },
    {
      pageType: "payment-form", action: "fill-card", fieldLabel: "card_cvv",
      matchedSelector: 'input[autocomplete="cc-csc"]', provenance: "CDP_SECRET", mode: "scripted",
    },
  ],
  schema: 1,
};

beforeEach(() => {
  completePromptMock.mockReset();
});

describe("buildNarrationFacts (sanitization)", () => {
  it("projects only labels + selectors, never values", () => {
    const facts = buildNarrationFacts(record);
    const json = JSON.stringify(facts);
    // No card-number-shaped digit run, no cvv/password values.
    expect(json).not.toMatch(/\d{13,19}/);
    expect(json).not.toMatch(/\bx_card_number\b/); // we record logical labels, not cred keys
    // The only string fields are the projected keys.
    for (const s of facts.selectors) {
      expect(Object.keys(s).sort()).toEqual(["action", "field", "mode", "pageType", "selector"]);
    }
  });

  it("feeds the same sanitized payload to the LLM", async () => {
    completePromptMock.mockResolvedValue("Watch the iframe.");
    await narrateLearnings(record);
    const [, userArg] = completePromptMock.mock.calls[0];
    expect(userArg).not.toMatch(/\d{13,19}/);
    expect(JSON.parse(userArg as string)).toHaveProperty("domain", "shop.example.com");
  });
});

describe("narrateLearnings (graceful degradation)", () => {
  it("returns undefined when the LLM call throws", async () => {
    completePromptMock.mockRejectedValue(new Error("OPENROUTER_API_KEY not configured"));
    expect(await narrateLearnings(record)).toBeUndefined();
  });

  it("returns undefined for empty output", async () => {
    completePromptMock.mockResolvedValue("   ");
    expect(await narrateLearnings(record)).toBeUndefined();
  });

  it("returns trimmed prose on success", async () => {
    completePromptMock.mockResolvedValue("  Use the guest checkout link.  ");
    expect(await narrateLearnings(record)).toBe("Use the guest checkout link.");
  });
});
