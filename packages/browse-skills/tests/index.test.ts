import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchAmazonMock, searchEbayMock, compareAmazonPricesMock } =
  vi.hoisted(() => ({
    searchAmazonMock: vi.fn(),
    searchEbayMock: vi.fn(),
    compareAmazonPricesMock: vi.fn(),
  }));

vi.mock("../src/skills/amazon-search.js", () => ({
  searchAmazon: (...args: unknown[]) => searchAmazonMock(...args),
}));
vi.mock("../src/skills/ebay-search.js", () => ({
  searchEbay: (...args: unknown[]) => searchEbayMock(...args),
}));
vi.mock("../src/skills/amazon-global-prices.js", () => ({
  compareAmazonPrices: (...args: unknown[]) => compareAmazonPricesMock(...args),
}));

import { searchProducts, comparePrices } from "../src/index.js";

describe("searchProducts", () => {
  beforeEach(() => {
    searchAmazonMock.mockResolvedValue({
      query: "q",
      products: [],
      source: "browse_sh",
    });
    searchEbayMock.mockResolvedValue({
      query: "q",
      products: [],
      source: "browse_sh",
    });
  });

  it("calls both Amazon and eBay in parallel", async () => {
    await searchProducts("headphones");
    expect(searchAmazonMock).toHaveBeenCalledWith("headphones");
    expect(searchEbayMock).toHaveBeenCalledWith("headphones");
  });

  it("merges results and sorts by price ascending", async () => {
    searchAmazonMock.mockResolvedValue({
      query: "headphones",
      source: "browse_sh",
      products: [
        {
          asin: "B001",
          title: "Sony A",
          price: "79.99",
          currency: "USD",
          url: "https://amazon.com/dp/B001",
        },
      ],
    });
    searchEbayMock.mockResolvedValue({
      query: "headphones",
      source: "browse_sh",
      products: [
        {
          item_id: "E001",
          title: "Bose B",
          price: "59.99",
          currency: "USD",
          url: "https://ebay.com/itm/E001",
        },
      ],
    });

    const result = await searchProducts("headphones");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.price).toBe("59.99");
    expect(result.results[0]?.source).toBe("ebay");
    expect(result.results[1]?.source).toBe("amazon");
    expect(result.source_breakdown).toEqual({ amazon: 1, ebay: 1 });
  });

  it("returns empty results when both sources are empty", async () => {
    const result = await searchProducts("nothing");
    expect(result.results).toHaveLength(0);
    expect(result.source_breakdown).toEqual({ amazon: 0, ebay: 0 });
  });
});

describe("comparePrices", () => {
  beforeEach(() => {
    searchAmazonMock.mockResolvedValue({
      query: "q",
      products: [],
      source: "browse_sh",
    });
  });

  it("returns empty comparisons and skips compareAmazonPrices when no ASIN found", async () => {
    const result = await comparePrices("rare item");
    expect(result.comparisons).toHaveLength(0);
    expect(compareAmazonPricesMock).not.toHaveBeenCalled();
  });

  it("uses the top ASIN from Amazon search and returns comparisons", async () => {
    searchAmazonMock.mockResolvedValue({
      query: "airpods",
      source: "browse_sh",
      products: [
        {
          asin: "B08PVNSPLK",
          title: "AirPods Pro",
          price: "249.99",
          currency: "USD",
          url: "https://amazon.com/dp/B08PVNSPLK",
        },
      ],
    });
    compareAmazonPricesMock.mockResolvedValue({
      asin: "B08PVNSPLK",
      source: "browse_sh",
      prices: [
        {
          storefront: "amazon.com",
          price: "249.99",
          currency: "USD",
          url: "https://amazon.com/dp/B08PVNSPLK",
          available: true,
        },
      ],
    });

    const result = await comparePrices("airpods");
    expect(result.asin).toBe("B08PVNSPLK");
    expect(result.comparisons).toHaveLength(1);
    expect(compareAmazonPricesMock).toHaveBeenCalledWith("B08PVNSPLK");
  });
});
