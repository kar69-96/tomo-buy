import { describe, it, expect, vi, beforeEach } from "vitest";

const { runSkillMock, isBrowseAvailableMock } = vi.hoisted(() => ({
  runSkillMock: vi.fn(),
  isBrowseAvailableMock: vi.fn(() => true),
}));

vi.mock("../src/client.js", () => ({
  isBrowseAvailable: isBrowseAvailableMock,
  runSkill: (...args: unknown[]) => runSkillMock(...args),
}));

import { searchAmazon } from "../src/skills/amazon-search.js";

describe("searchAmazon", () => {
  beforeEach(() => {
    runSkillMock.mockReset();
    isBrowseAvailableMock.mockReturnValue(true);
  });

  it("returns empty products without calling runSkill when browse is unavailable", async () => {
    isBrowseAvailableMock.mockReturnValue(false);
    const result = await searchAmazon("airpods");
    expect(result.products).toHaveLength(0);
    expect(result.source).toBe("browse_sh");
    expect(runSkillMock).not.toHaveBeenCalled();
  });

  it("normalizes well-formed raw output with 'products' key", async () => {
    runSkillMock.mockResolvedValue({
      products: [
        {
          asin: "B08PVNSPLK",
          title: "AirPods Pro 2nd Gen",
          price: "249.99",
          currency: "USD",
          url: "https://amazon.com/dp/B08PVNSPLK",
          rating: 4.7,
          review_count: 18000,
        },
      ],
    });
    const result = await searchAmazon("airpods pro");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.asin).toBe("B08PVNSPLK");
    expect(result.products[0]?.price).toBe("249.99");
    expect(result.products[0]?.rating).toBe(4.7);
  });

  it("handles the alternate 'results' key instead of 'products'", async () => {
    runSkillMock.mockResolvedValue({
      results: [
        {
          asin: "B003",
          title: "Alt key product",
          price: "50.00",
          currency: "USD",
          url: "https://amazon.com/dp/B003",
        },
      ],
    });
    const result = await searchAmazon("test");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.asin).toBe("B003");
  });

  it("drops products with missing required fields", async () => {
    runSkillMock.mockResolvedValue({
      products: [
        { title: "No ASIN", price: "10.00" },
        { asin: "B001", price: "20.00" },
        {
          asin: "B002",
          title: "Valid",
          price: "30.00",
          currency: "USD",
          url: "https://amazon.com/dp/B002",
        },
      ],
    });
    const result = await searchAmazon("test");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.asin).toBe("B002");
  });

  it("strips non-numeric chars from price strings", async () => {
    runSkillMock.mockResolvedValue({
      products: [
        {
          asin: "B004",
          title: "Item",
          price: "$49.99",
          currency: "USD",
          url: "https://amazon.com/dp/B004",
        },
      ],
    });
    const result = await searchAmazon("item");
    expect(result.products[0]?.price).toBe("49.99");
  });

  it("returns empty products without throwing when runSkill rejects", async () => {
    runSkillMock.mockRejectedValue(new Error("browse CLI not installed"));
    const result = await searchAmazon("airpods");
    expect(result.products).toHaveLength(0);
  });

  it("synthesizes a fallback URL from ASIN when url is missing", async () => {
    runSkillMock.mockResolvedValue({
      products: [{ asin: "B005", title: "No URL", price: "20.00" }],
    });
    const result = await searchAmazon("no url");
    expect(result.products[0]?.url).toBe("https://www.amazon.com/dp/B005");
  });
});
