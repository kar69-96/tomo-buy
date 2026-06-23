import { describe, it, expect } from "vitest";
import { parseSearchQuery } from "../src/nl-search.js";

describe("parseSearchQuery", () => {
  // ---- Domain extraction ----

  it("extracts domain from 'on amazon'", () => {
    const result = parseSearchQuery("towels on amazon under $15");
    expect(result.domains).toEqual(["amazon.com"]);
  });

  it("extracts domain from 'from target'", () => {
    const result = parseSearchQuery("headphones from target");
    expect(result.domains).toEqual(["target.com"]);
  });

  it("extracts domain from 'at walmart'", () => {
    const result = parseSearchQuery("batteries at walmart");
    expect(result.domains).toEqual(["walmart.com"]);
  });

  it("extracts direct domain mention (target.com)", () => {
    const result = parseSearchQuery("towels target.com");
    expect(result.domains).toEqual(["target.com"]);
  });

  it("handles multi-word store names like 'best buy'", () => {
    const result = parseSearchQuery("laptops on best buy");
    expect(result.domains).toEqual(["bestbuy.com"]);
  });

  it("handles multi-word store names like 'home depot'", () => {
    const result = parseSearchQuery("tools from home depot");
    expect(result.domains).toEqual(["homedepot.com"]);
  });

  it("returns empty domains for unknown stores", () => {
    const result = parseSearchQuery("towels on somefakestore");
    expect(result.domains).toEqual([]);
  });

  it("returns empty domains when no store mentioned", () => {
    const result = parseSearchQuery("best towels under $10");
    expect(result.domains).toEqual([]);
  });

  // ---- Price extraction ----

  it("extracts max price from 'under $15'", () => {
    const result = parseSearchQuery("towels under $15");
    expect(result.maxPrice).toBe(15);
    expect(result.minPrice).toBeUndefined();
  });

  it("extracts max price from 'below $20.50'", () => {
    const result = parseSearchQuery("socks below $20.50");
    expect(result.maxPrice).toBe(20.5);
  });

  it("extracts max price from 'less than $30'", () => {
    const result = parseSearchQuery("shoes less than $30");
    expect(result.maxPrice).toBe(30);
  });

  it("extracts min price from 'over $10'", () => {
    const result = parseSearchQuery("headphones over $10");
    expect(result.minPrice).toBe(10);
    expect(result.maxPrice).toBeUndefined();
  });

  it("extracts min price from 'above $5'", () => {
    const result = parseSearchQuery("pens above $5");
    expect(result.minPrice).toBe(5);
  });

  it("extracts price range from '$10-$20'", () => {
    const result = parseSearchQuery("shirts $10-$20");
    expect(result.minPrice).toBe(10);
    expect(result.maxPrice).toBe(20);
  });

  it("extracts price range from '$10 to $20'", () => {
    const result = parseSearchQuery("shirts $10 to $20");
    expect(result.minPrice).toBe(10);
    expect(result.maxPrice).toBe(20);
  });

  it("extracts price range from 'between $5 and $15'", () => {
    const result = parseSearchQuery("towels between $5 and $15");
    expect(result.minPrice).toBe(5);
    expect(result.maxPrice).toBe(15);
  });

  it("returns undefined prices when none mentioned", () => {
    const result = parseSearchQuery("blue towels");
    expect(result.minPrice).toBeUndefined();
    expect(result.maxPrice).toBeUndefined();
  });

  // ---- Cleaned terms ----

  it("strips domain phrase from cleaned terms", () => {
    const result = parseSearchQuery("towels on amazon under $15");
    expect(result.cleanedTerms).not.toContain("amazon");
    expect(result.cleanedTerms).toContain("towels");
  });

  it("strips price phrase from cleaned terms", () => {
    const result = parseSearchQuery("towels under $15");
    expect(result.cleanedTerms).not.toContain("$15");
    expect(result.cleanedTerms).not.toContain("under");
    expect(result.cleanedTerms).toContain("towels");
  });

  it("preserves meaningful terms", () => {
    const result = parseSearchQuery("blue cotton towels on amazon under $15");
    expect(result.cleanedTerms).toContain("blue");
    expect(result.cleanedTerms).toContain("cotton");
    expect(result.cleanedTerms).toContain("towels");
  });

  it("trims whitespace in cleaned terms", () => {
    const result = parseSearchQuery("  towels   on amazon  ");
    expect(result.cleanedTerms).toBe("towels");
  });

  // ---- Edge cases ----

  it("handles empty string", () => {
    const result = parseSearchQuery("");
    expect(result.cleanedTerms).toBe("");
    expect(result.domains).toEqual([]);
    expect(result.minPrice).toBeUndefined();
    expect(result.maxPrice).toBeUndefined();
  });

  it("handles query with only a domain", () => {
    const result = parseSearchQuery("on amazon");
    expect(result.domains).toEqual(["amazon.com"]);
  });

  it("handles combined domain + price range", () => {
    const result = parseSearchQuery("shoes on nike $50-$100");
    expect(result.domains).toEqual(["nike.com"]);
    expect(result.minPrice).toBe(50);
    expect(result.maxPrice).toBe(100);
  });
});
