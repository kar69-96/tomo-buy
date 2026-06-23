import { describe, it, expect, vi, beforeEach } from "vitest";
import { BloonError } from "@bloon/core";

// Mock crawling module
vi.mock("@bloon/crawling", () => ({
  parseSearchQuery: vi.fn(),
  searchProducts: vi.fn(),
  classifyUrl: vi.fn().mockReturnValue("exa_first"),
  enrichVariantPricesViaExa: vi.fn().mockImplementation((_name: string, _url: string, opts: unknown[]) => Promise.resolve(opts)),
  fetchShopifyOptions: vi.fn().mockResolvedValue(null),
}));

// Mock checkout module (resolveVariantPricesViaBrowser for blocked_only enrichment)
vi.mock("@bloon/checkout", () => ({
  resolveVariantPricesViaBrowser: vi.fn().mockImplementation((_url: string, opts: unknown[]) => Promise.resolve(opts)),
}));

import { parseSearchQuery, searchProducts } from "@bloon/crawling";
import { searchQuery } from "../src/search-query.js";

const mockedParse = vi.mocked(parseSearchQuery);
const mockedSearch = vi.mocked(searchProducts);

function makeSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Product",
    url: "https://example.com/product",
    price: "12.99",
    options: [],
    relevance_score: 0.85,
    ...overrides,
  };
}

describe("searchQuery", () => {
  beforeEach(() => {
    mockedParse.mockReset();
    mockedSearch.mockReset();

    // Default parse result
    mockedParse.mockReturnValue({
      cleanedTerms: "towels",
      domains: [],
      minPrice: undefined,
      maxPrice: undefined,
    });
  });

  it("returns search results for a valid query", async () => {
    mockedSearch.mockResolvedValue([
      makeSearchResult({ name: "Towel A", price: "10.00", relevance_score: 0.9 }),
      makeSearchResult({ name: "Towel B", price: "12.00", relevance_score: 0.8 }),
    ]);

    const result = await searchQuery({ query: "towels" });

    expect(result.type).toBe("search");
    expect(result.query).toBe("towels");
    expect(result.products).toHaveLength(2);
    expect(result.products[0].product.name).toBe("Towel A");
    expect(result.products[0].discovery_method).toBe("exa_search");
  });

  it("throws MISSING_FIELD for empty query", async () => {
    await expect(searchQuery({ query: "" })).rejects.toThrow(BloonError);
    await expect(searchQuery({ query: " " })).rejects.toThrow(BloonError);
  });

  it("throws MISSING_FIELD for single-char query", async () => {
    await expect(searchQuery({ query: "x" })).rejects.toThrow(BloonError);
  });

  it("throws MISSING_FIELD when cleaned terms are too short", async () => {
    mockedParse.mockReturnValue({
      cleanedTerms: "x",
      domains: ["amazon.com"],
      minPrice: undefined,
      maxPrice: undefined,
    });

    await expect(searchQuery({ query: "on amazon" })).rejects.toThrow(BloonError);
  });

  it("filters by max price", async () => {
    mockedParse.mockReturnValue({
      cleanedTerms: "towels",
      domains: [],
      minPrice: undefined,
      maxPrice: 15,
    });

    mockedSearch.mockResolvedValue([
      makeSearchResult({ name: "Cheap", price: "10.00", relevance_score: 0.9 }),
      makeSearchResult({ name: "Expensive", price: "20.00", relevance_score: 0.95 }),
    ]);

    const result = await searchQuery({ query: "towels under $15" });

    expect(result.products).toHaveLength(1);
    expect(result.products[0].product.name).toBe("Cheap");
    expect(result.search_metadata.price_filter).toEqual({ max: 15 });
  });

  it("filters by min price", async () => {
    mockedParse.mockReturnValue({
      cleanedTerms: "headphones",
      domains: [],
      minPrice: 50,
      maxPrice: undefined,
    });

    mockedSearch.mockResolvedValue([
      makeSearchResult({ name: "Budget", price: "20.00", relevance_score: 0.9 }),
      makeSearchResult({ name: "Premium", price: "80.00", relevance_score: 0.85 }),
    ]);

    const result = await searchQuery({ query: "headphones over $50" });

    expect(result.products).toHaveLength(1);
    expect(result.products[0].product.name).toBe("Premium");
    expect(result.search_metadata.price_filter).toEqual({ min: 50 });
  });

  it("limits results to top 5", async () => {
    mockedSearch.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) =>
        makeSearchResult({
          name: `Product ${i}`,
          url: `https://example.com/${i}`,
          price: `${10 + i}.00`,
          relevance_score: 0.9 - i * 0.05,
        }),
      ),
    );

    const result = await searchQuery({ query: "towels" });

    expect(result.products).toHaveLength(5);
    expect(result.search_metadata.total_found).toBe(5);
  });

  it("sorts by relevance score (highest first)", async () => {
    mockedSearch.mockResolvedValue([
      makeSearchResult({ name: "Low", relevance_score: 0.5 }),
      makeSearchResult({ name: "High", relevance_score: 0.95 }),
      makeSearchResult({ name: "Mid", relevance_score: 0.75 }),
    ]);

    const result = await searchQuery({ query: "towels" });

    expect(result.products[0].product.name).toBe("High");
    expect(result.products[2].product.name).toBe("Low");
  });

  it("passes domain filter to search", async () => {
    mockedParse.mockReturnValue({
      cleanedTerms: "towels",
      domains: ["amazon.com"],
      minPrice: undefined,
      maxPrice: undefined,
    });

    mockedSearch.mockResolvedValue([
      makeSearchResult(),
    ]);

    const result = await searchQuery({ query: "towels on amazon" });

    expect(mockedSearch).toHaveBeenCalledWith(
      "towels",
      expect.objectContaining({ includeDomains: ["amazon.com"] }),
    );
    expect(result.search_metadata.domain_filter).toEqual(["amazon.com"]);
  });

  it("throws SEARCH_NO_RESULTS when Exa returns empty", async () => {
    mockedSearch.mockResolvedValue([]);

    await expect(searchQuery({ query: "nonexistent product" })).rejects.toThrow(
      expect.objectContaining({ code: "SEARCH_NO_RESULTS" }),
    );
  });

  it("throws SEARCH_NO_RESULTS when all results fail price filter", async () => {
    mockedParse.mockReturnValue({
      cleanedTerms: "towels",
      domains: [],
      minPrice: undefined,
      maxPrice: 5,
    });

    mockedSearch.mockResolvedValue([
      makeSearchResult({ price: "20.00" }),
    ]);

    await expect(searchQuery({ query: "towels under $5" })).rejects.toThrow(
      expect.objectContaining({ code: "SEARCH_NO_RESULTS" }),
    );
  });

  it("throws SEARCH_UNAVAILABLE when EXA_API_KEY is missing", async () => {
    mockedSearch.mockRejectedValue(new Error("EXA_API_KEY not set"));

    await expect(searchQuery({ query: "towels" })).rejects.toThrow(
      expect.objectContaining({ code: "SEARCH_UNAVAILABLE" }),
    );
  });

  it("throws SEARCH_RATE_LIMITED on 429", async () => {
    mockedSearch.mockRejectedValue(new Error("429 rate limit exceeded"));

    await expect(searchQuery({ query: "towels" })).rejects.toThrow(
      expect.objectContaining({ code: "SEARCH_RATE_LIMITED" }),
    );
  });

  it("includes required_fields with shipping for each product", async () => {
    mockedSearch.mockResolvedValue([makeSearchResult()]);

    const result = await searchQuery({ query: "towels" });

    const fields = result.products[0].required_fields;
    expect(fields.some((f) => f.field === "shipping.name")).toBe(true);
    expect(fields.some((f) => f.field === "shipping.email")).toBe(true);
    expect(fields.some((f) => f.field === "shipping.street")).toBe(true);
  });

  it("adds selections to required_fields when product has options", async () => {
    mockedSearch.mockResolvedValue([
      makeSearchResult({
        options: [{ name: "Size", values: ["S", "M", "L"] }],
      }),
    ]);

    const result = await searchQuery({ query: "shirts" });

    const fields = result.products[0].required_fields;
    expect(fields.some((f) => f.field === "selections")).toBe(true);
  });

  it("omits price_filter from metadata when no price constraint", async () => {
    mockedSearch.mockResolvedValue([makeSearchResult()]);

    const result = await searchQuery({ query: "towels" });

    expect(result.search_metadata.price_filter).toBeUndefined();
  });

  it("omits domain_filter from metadata when no domain", async () => {
    mockedSearch.mockResolvedValue([makeSearchResult()]);

    const result = await searchQuery({ query: "towels" });

    expect(result.search_metadata.domain_filter).toBeUndefined();
  });
});
