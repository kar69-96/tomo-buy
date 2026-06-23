import { describe, it, expect } from "vitest";
import { chooseBestCandidate, rankCandidate } from "../src/parser-ensemble.js";

describe("parser ensemble ranking", () => {
  it("prefers candidate with valid price and richer signals", () => {
    const weak = rankCandidate({
      source: "firecrawl",
      extract: { name: "Product", price: "NaN" },
    });
    const strong = rankCandidate({
      source: "browserbase",
      extract: {
        name: "Product",
        price: "$29.99",
        currency: "USD",
        options: [{ name: "Size", values: ["S", "M"] }],
      },
    });

    expect(weak).not.toBeNull();
    expect(strong).not.toBeNull();
    expect((strong?.confidence ?? 0) > (weak?.confidence ?? 0)).toBe(true);
  });

  it("returns null when candidate has no usable fields", () => {
    const ranked = rankCandidate({
      source: "firecrawl",
      extract: { name: "null", price: "undefined" },
    });
    expect(ranked).toBeNull();
  });

  it("chooses best candidate across sources", () => {
    const best = chooseBestCandidate([
      { source: "firecrawl", extract: { name: "Item", price: "10.00" } },
      {
        source: "browserbase",
        extract: {
          name: "Item",
          price: "$10.00",
          options: [{ name: "Color", values: ["Red", "Blue"] }],
        },
      },
    ]);
    expect(best).not.toBeNull();
    expect(best!.source).toBe("browserbase");
  });
});
