import { describe, it, expect, vi, beforeEach } from "vitest";

const { runSkillMock, isBrowseAvailableMock } = vi.hoisted(() => ({
  runSkillMock: vi.fn(),
  isBrowseAvailableMock: vi.fn(() => true),
}));

vi.mock("../src/client.js", () => ({
  isBrowseAvailable: isBrowseAvailableMock,
  runSkill: (...args: unknown[]) => runSkillMock(...args),
}));

import { compareAmazonPrices } from "../src/skills/amazon-global-prices.js";

describe("compareAmazonPrices", () => {
  beforeEach(() => {
    runSkillMock.mockReset();
    isBrowseAvailableMock.mockReturnValue(true);
  });

  it("returns empty prices without calling runSkill when browse is unavailable", async () => {
    isBrowseAvailableMock.mockReturnValue(false);
    const result = await compareAmazonPrices("B08PVNSPLK");
    expect(result.prices).toHaveLength(0);
    expect(runSkillMock).not.toHaveBeenCalled();
  });

  it("returns only available storefronts", async () => {
    runSkillMock.mockResolvedValue({
      prices: [
        {
          storefront: "amazon.com",
          price: "249.99",
          currency: "USD",
          url: "https://amazon.com/dp/B08",
          available: true,
        },
        {
          storefront: "amazon.co.uk",
          price: "239.00",
          currency: "GBP",
          url: "https://amazon.co.uk/dp/B08",
          available: false,
        },
        {
          storefront: "amazon.de",
          price: "269.00",
          currency: "EUR",
          url: "https://amazon.de/dp/B08",
          available: true,
        },
      ],
    });
    const result = await compareAmazonPrices("B08PVNSPLK");
    expect(result.prices).toHaveLength(2);
    expect(result.prices.map((p) => p.storefront)).toEqual([
      "amazon.com",
      "amazon.de",
    ]);
  });

  it("handles the alternate 'storefronts' key and 'marketplace' field", async () => {
    runSkillMock.mockResolvedValue({
      storefronts: [
        {
          marketplace: "amazon.com",
          price: "249.99",
          currency: "USD",
          url: "https://amazon.com/dp/B08",
          available: true,
        },
      ],
    });
    const result = await compareAmazonPrices("B08PVNSPLK");
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.storefront).toBe("amazon.com");
  });

  it("drops entries with missing storefront or price", async () => {
    runSkillMock.mockResolvedValue({
      prices: [
        { price: "10.00", currency: "USD", url: "", available: true },
        { storefront: "amazon.com", currency: "USD", url: "", available: true },
        {
          storefront: "amazon.fr",
          price: "299.00",
          currency: "EUR",
          url: "https://amazon.fr/dp/B08",
          available: true,
        },
      ],
    });
    const result = await compareAmazonPrices("B08PVNSPLK");
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.storefront).toBe("amazon.fr");
  });

  it("returns empty prices without throwing when runSkill rejects", async () => {
    runSkillMock.mockRejectedValue(new Error("network error"));
    const result = await compareAmazonPrices("B08PVNSPLK");
    expect(result.prices).toHaveLength(0);
  });
});
