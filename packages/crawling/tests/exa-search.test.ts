import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock exa-js before importing the module under test
const mockSearchAndContents = vi.fn();

vi.mock("exa-js", () => {
  return {
    default: class MockExa {
      searchAndContents = mockSearchAndContents;
    },
  };
});

import { searchProducts, isUrlReachable, isProductPage } from "../src/exa-search.js";

// --- Helpers ---

function makeSearchResponse(results: Array<{
  url: string;
  summary: string;
  score?: number;
}>) {
  return {
    results: results.map((r, i) => ({
      url: r.url,
      title: `Product ${i}`,
      id: `id-${i}`,
      summary: r.summary,
      score: r.score ?? 0.8,
    })),
    requestId: "req-search",
  };
}

function mockFetchStatus(status: number) {
  return vi.fn().mockResolvedValue({ status });
}

function mockFetchNetworkError(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

// --- isProductPage ---

describe("isProductPage", () => {
  // --- Valid product pages ---
  it("returns true for standard retail product pages", () => {
    expect(isProductPage("https://www.amazon.com/Baratza-Encore/dp/B007F183LK")).toBe(true);
    expect(isProductPage("https://www.target.com/p/some-product/-/A-12345")).toBe(true);
    expect(isProductPage("https://www.brooklinen.com/products/super-plush-bath-towels")).toBe(true);
    expect(isProductPage("https://www.nike.com/t/pegasus-41/FD2722-108")).toBe(true);
    expect(isProductPage("https://www.otterbox.com/en-us/magsafe-iphone-15-pro-case/75-00156.html")).toBe(true);
    expect(isProductPage("https://jadeyoga.com/collections/yoga-mats/products/level-1-mat?variant=530519457810")).toBe(true);
    expect(isProductPage("https://www.manduka.com/collections/begin-mat")).toBe(true);
  });

  // --- Domain blocklist ---
  it("returns false for tech editorial/review domains", () => {
    expect(isProductPage("https://www.nytimes.com/wirecutter/reviews/best-coffee-grinder/")).toBe(false);
    expect(isProductPage("https://cnet.com/reviews/best-earbuds/")).toBe(false);
    expect(isProductPage("https://www.theverge.com/best-picks/phone-cases")).toBe(false);
    expect(isProductPage("https://www.pcmag.com/picks/best-running-shoes")).toBe(false);
    expect(isProductPage("https://www.rtings.com/headphones/reviews/best/")).toBe(false);
    expect(isProductPage("https://www.tomshardware.com/best-picks/")).toBe(false);
    expect(isProductPage("https://www.wired.com/gallery/best-water-bottles/")).toBe(false);
  });

  it("returns false for general media/lifestyle editorial domains", () => {
    expect(isProductPage("https://www.forbes.com/advisor/best-water-bottles/")).toBe(false);
    expect(isProductPage("https://www.goodhousekeeping.com/product-reviews/")).toBe(false);
    expect(isProductPage("https://www.healthline.com/nutrition/best-sunscreen")).toBe(false);
    expect(isProductPage("https://www.menshealth.com/fitness/running-shoes/")).toBe(false);
    expect(isProductPage("https://www.thespruce.com/best-bath-towels/")).toBe(false);
    expect(isProductPage("https://www.buzzfeed.com/shopping/best-items")).toBe(false);
  });

  it("returns false for deal, coupon, and price-tracker domains", () => {
    expect(isProductPage("https://slickdeals.net/deals/coffee-grinder")).toBe(false);
    expect(isProductPage("https://www.retailmenot.com/")).toBe(false);
    expect(isProductPage("https://camelcamelcamel.com/product/B007F183LK")).toBe(false);
    expect(isProductPage("https://www.groupon.com/deals/shoes")).toBe(false);
  });

  it("returns false for social and community domains", () => {
    expect(isProductPage("https://www.reddit.com/r/running/comments/123/")).toBe(false);
    expect(isProductPage("https://www.pinterest.com/ideas/yoga-mats/")).toBe(false);
    expect(isProductPage("https://www.youtube.com/watch?v=abc123")).toBe(false);
    expect(isProductPage("https://www.instagram.com/p/abc123/")).toBe(false);
    expect(isProductPage("https://medium.com/running/best-shoes")).toBe(false);
  });

  it("returns false for search engines and comparison sites", () => {
    expect(isProductPage("https://www.google.com/search?q=coffee+grinder")).toBe(false);
    expect(isProductPage("https://www.bing.com/search?q=yoga+mat")).toBe(false);
  });

  it("returns false for subdomains of blocked domains", () => {
    expect(isProductPage("https://shop.nytimes.com/products/something")).toBe(false);
    expect(isProductPage("https://reviews.cnet.com/best-picks/")).toBe(false);
    expect(isProductPage("https://m.reddit.com/r/gadgets/")).toBe(false);
  });

  // --- Staging/environment detection ---
  it("returns false for staging and UAT subdomains", () => {
    expect(isProductPage("https://uat-cd-us.cerave.com/products/spf50")).toBe(false);
    expect(isProductPage("https://uat.example.com/products/item")).toBe(false);
    expect(isProductPage("https://staging.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://stg.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://dev.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://test.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://qa.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://preprod.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://sandbox.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://demo.mystore.com/products/widget")).toBe(false);
    expect(isProductPage("https://preview.mystore.com/products/widget")).toBe(false);
  });

  // --- Search results URL detection ---
  it("returns false for Amazon search result URLs", () => {
    expect(isProductPage("https://www.amazon.com/s?k=coffee+grinder")).toBe(false);
    expect(isProductPage("https://www.amazon.com/t-shirts/s?k=t-shirts")).toBe(false);
    expect(isProductPage("https://www.amazon.co.uk/Best-Bath-Towels/s?k=bath+towels")).toBe(false);
  });

  it("returns true for Amazon product detail URLs", () => {
    expect(isProductPage("https://www.amazon.com/Baratza-Encore/dp/B007F183LK")).toBe(true);
    expect(isProductPage("https://www.amazon.com/dp/B08EXAMPLE")).toBe(true);
    expect(isProductPage("https://www.amazon.com/gp/product/B07EXAMPLE")).toBe(true);
  });

  it("returns false for generic search result paths", () => {
    expect(isProductPage("https://example.com/search?q=towels")).toBe(false);
    expect(isProductPage("https://shop.example.com/search/results")).toBe(false);
  });

  // --- Editorial path patterns ---
  it("returns false for editorial/non-product URL paths", () => {
    expect(isProductPage("https://anystore.com/reviews/best-towels/")).toBe(false);
    expect(isProductPage("https://anystore.com/blog/towel-guide")).toBe(false);
    expect(isProductPage("https://anystore.com/news/new-products")).toBe(false);
    expect(isProductPage("https://anystore.com/articles/buying-guide")).toBe(false);
    expect(isProductPage("https://anystore.com/buying-guide/towels")).toBe(false);
    expect(isProductPage("https://anystore.com/guide/how-to-choose")).toBe(false);
    expect(isProductPage("https://anystore.com/wiki/product-info")).toBe(false);
    expect(isProductPage("https://anystore.com/compare/towels")).toBe(false);
    expect(isProductPage("https://anystore.com/forum/discussion")).toBe(false);
  });

  // --- Safe product-like paths should not be blocked ---
  it("returns true for product pages with ambiguous but valid paths", () => {
    expect(isProductPage("https://example.com/products/best-shampoo")).toBe(true);
    expect(isProductPage("https://example.com/shop/new-arrivals")).toBe(true);
    expect(isProductPage("https://example.com/item/12345-widget")).toBe(true);
    expect(isProductPage("https://example.com/pd/some-product")).toBe(true);
  });

  // --- Protocol & parse errors ---
  it("returns false for non-HTTP protocols and invalid URLs", () => {
    expect(isProductPage("not-a-url")).toBe(false);
    expect(isProductPage("")).toBe(false);
    expect(isProductPage("ftp://example.com/product")).toBe(false);
    expect(isProductPage("mailto:test@example.com")).toBe(false);
  });
});

// --- isUrlReachable ---

describe("isUrlReachable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true for 200 OK", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(200));
    await expect(isUrlReachable("https://example.com/product")).resolves.toBe(true);
  });

  it("returns true for 403 (bot-blocked, real site)", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(403));
    await expect(isUrlReachable("https://amazon.com/product")).resolves.toBe(true);
  });

  it("returns true for 429 (rate limited, real site)", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(429));
    await expect(isUrlReachable("https://example.com/product")).resolves.toBe(true);
  });

  it("returns true for 500 (server error, real site)", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(500));
    await expect(isUrlReachable("https://example.com/product")).resolves.toBe(true);
  });

  it("returns true for 301 redirect followed to 200", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(200));
    await expect(isUrlReachable("https://example.com/old-path")).resolves.toBe(true);
  });

  it("returns false for 404", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(404));
    await expect(isUrlReachable("https://example.com/gone")).resolves.toBe(false);
  });

  it("returns false for 410 Gone", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(410));
    await expect(isUrlReachable("https://example.com/deleted")).resolves.toBe(false);
  });

  it("returns false for ENOTFOUND (dead domain)", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError("getaddrinfo ENOTFOUND dead-domain.example"));
    await expect(isUrlReachable("https://dead-domain.example/product")).resolves.toBe(false);
  });

  it("returns false for ECONNREFUSED", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError("connect ECONNREFUSED 127.0.0.1:443"));
    await expect(isUrlReachable("https://localhost/product")).resolves.toBe(false);
  });

  it("returns true on timeout (AbortError) — benefit of the doubt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })));
    await expect(isUrlReachable("https://slow-site.example/product")).resolves.toBe(true);
  });

  it("returns true for SSL errors", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError("SSL certificate error"));
    await expect(isUrlReachable("https://example.com/product")).resolves.toBe(true);
  });
});

// --- searchProducts ---

describe("searchProducts", () => {
  const originalKey = process.env.EXA_API_KEY;
  const mockFetch = vi.fn();

  beforeEach(() => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockSearchAndContents.mockReset();
    // Default: all URLs are reachable (200)
    mockFetch.mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey !== undefined) {
      process.env.EXA_API_KEY = originalKey;
    } else {
      delete process.env.EXA_API_KEY;
    }
  });

  it("returns validated products from search results", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://amazon.com/product/1",
          summary: JSON.stringify({ name: "Cotton Towels", price: "$12.99", brand: "Basics" }),
          score: 0.92,
        },
        {
          url: "https://amazon.com/product/2",
          summary: JSON.stringify({ name: "Bath Towels", price: "$14.50" }),
          score: 0.85,
        },
      ]),
    );

    const results = await searchProducts("towels");
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("Cotton Towels");
    expect(results[0].price).toBe("12.99");
    expect(results[0].brand).toBe("Basics");
    expect(results[0].url).toBe("https://amazon.com/product/1");
    expect(results[0].relevance_score).toBe(0.92);
    expect(results[1].name).toBe("Bath Towels");
    expect(results[1].price).toBe("14.50");
  });

  it("filters out results with missing name", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/1",
          summary: JSON.stringify({ price: "$10.00" }),
        },
        {
          url: "https://example.com/2",
          summary: JSON.stringify({ name: "Valid Product", price: "$15.00" }),
        },
      ]),
    );

    const results = await searchProducts("stuff");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Valid Product");
  });

  it("filters out results with invalid price", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/1",
          summary: JSON.stringify({ name: "Free Item", price: "free" }),
        },
        {
          url: "https://example.com/2",
          summary: JSON.stringify({ name: "Zero Price", price: "$0.00" }),
        },
        {
          url: "https://example.com/3",
          summary: JSON.stringify({ name: "Good Item", price: "$9.99" }),
        },
      ]),
    );

    const results = await searchProducts("items");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Good Item");
  });

  it("filters out results with unparseable summary", async () => {
    mockSearchAndContents.mockResolvedValue({
      results: [
        {
          url: "https://example.com/1",
          title: "Bad",
          id: "x",
          summary: "not json",
          score: 0.9,
        },
        {
          url: "https://example.com/2",
          title: "Good",
          id: "y",
          summary: JSON.stringify({ name: "Widget", price: "$5.00" }),
          score: 0.8,
        },
      ],
      requestId: "r",
    });

    const results = await searchProducts("widget");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Widget");
  });

  it("passes includeDomains to Exa", async () => {
    mockSearchAndContents.mockResolvedValue({ results: [], requestId: "r" });

    await searchProducts("towels", { includeDomains: ["amazon.com"] });

    expect(mockSearchAndContents).toHaveBeenCalledWith(
      "towels",
      expect.objectContaining({ includeDomains: ["amazon.com"] }),
    );
  });

  it("strips currency from prices", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/1",
          summary: JSON.stringify({ name: "Euro Item", price: "€47,49" }),
        },
      ]),
    );

    const results = await searchProducts("item");
    expect(results).toHaveLength(1);
    expect(results[0].price).toBe("47.49");
  });

  it("parses product options from summary", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/1",
          summary: JSON.stringify({
            name: "T-Shirt",
            price: "$19.99",
            options: JSON.stringify([
              { name: "Size", values: ["S", "M", "L"] },
              { name: "Color", values: ["Red", "Blue"] },
            ]),
          }),
        },
      ]),
    );

    const results = await searchProducts("t-shirt");
    expect(results).toHaveLength(1);
    expect(results[0].options).toHaveLength(2);
    expect(results[0].options[0].name).toBe("Size");
    expect(results[0].options[0].values).toEqual(["S", "M", "L"]);
  });

  it("handles empty results", async () => {
    mockSearchAndContents.mockResolvedValue({ results: [], requestId: "r" });

    const results = await searchProducts("nonexistent item");
    expect(results).toHaveLength(0);
  });

  it("cleans optional fields (null/undefined strings)", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/1",
          summary: JSON.stringify({
            name: "Widget",
            price: "$10.00",
            brand: "null",
            image_url: "undefined",
            original_price: "",
          }),
        },
      ]),
    );

    const results = await searchProducts("widget");
    expect(results).toHaveLength(1);
    expect(results[0].brand).toBeUndefined();
    expect(results[0].image_url).toBeUndefined();
    expect(results[0].original_price).toBeUndefined();
  });

  // --- Retail page filtering ---

  it("drops editorial/review site results", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://www.nytimes.com/wirecutter/reviews/best-coffee-grinder/",
          summary: JSON.stringify({ name: "Baratza Encore", price: "$169" }),
          score: 0.95,
        },
        {
          url: "https://www.amazon.com/Baratza-Encore/dp/B007F183LK",
          summary: JSON.stringify({ name: "Baratza Encore Conical Grinder", price: "$169.00" }),
          score: 0.90,
        },
      ]),
    );

    const results = await searchProducts("coffee grinder");
    expect(results).toHaveLength(1);
    expect(results[0].url).toContain("amazon.com");
  });

  it("drops staging/UAT subdomain results", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://uat-cd-us.cerave.com/products/spf50",
          summary: JSON.stringify({ name: "CeraVe SPF 50", price: "$19.99" }),
          score: 0.92,
        },
        {
          url: "https://www.cerave.com/products/spf50",
          summary: JSON.stringify({ name: "CeraVe SPF 50", price: "$19.99" }),
          score: 0.88,
        },
      ]),
    );

    const results = await searchProducts("sunscreen spf 50");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://www.cerave.com/products/spf50");
  });

  // --- URL reachability filtering ---

  it("drops products with 404 URLs", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/gone",
          summary: JSON.stringify({ name: "Dead Product", price: "$10.00" }),
          score: 0.9,
        },
        {
          url: "https://example.com/alive",
          summary: JSON.stringify({ name: "Live Product", price: "$15.00" }),
          score: 0.85,
        },
      ]),
    );

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/gone")) return Promise.resolve({ status: 404 });
      return Promise.resolve({ status: 200 });
    });

    const results = await searchProducts("products");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Live Product");
  });

  it("drops products with 410 Gone URLs", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/deleted",
          summary: JSON.stringify({ name: "Deleted Product", price: "$10.00" }),
        },
      ]),
    );

    mockFetch.mockResolvedValue({ status: 410 });

    const results = await searchProducts("products");
    expect(results).toHaveLength(0);
  });

  it("drops products with ENOTFOUND domain errors", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://dead-domain.example/product",
          summary: JSON.stringify({ name: "Ghost Product", price: "$20.00" }),
        },
      ]),
    );

    mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND dead-domain.example"));

    const results = await searchProducts("products");
    expect(results).toHaveLength(0);
  });

  it("keeps products with 403 URLs (bot-blocked real sites)", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://amazon.com/dp/B08EXAMPLE",
          summary: JSON.stringify({ name: "Amazon Product", price: "$19.99" }),
        },
      ]),
    );

    mockFetch.mockResolvedValue({ status: 403 });

    const results = await searchProducts("products");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Amazon Product");
  });

  it("keeps products with timeout URLs (benefit of the doubt)", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://slow-site.example/product",
          summary: JSON.stringify({ name: "Slow Product", price: "$12.00" }),
        },
      ]),
    );

    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    mockFetch.mockRejectedValue(abortError);

    const results = await searchProducts("products");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Slow Product");
  });

  it("filters mixed batch — returns only reachable URLs", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/ok-1",
          summary: JSON.stringify({ name: "Reachable A", price: "$10.00" }),
          score: 0.95,
        },
        {
          url: "https://example.com/gone",
          summary: JSON.stringify({ name: "Gone Product", price: "$11.00" }),
          score: 0.90,
        },
        {
          url: "https://example.com/ok-2",
          summary: JSON.stringify({ name: "Reachable B", price: "$12.00" }),
          score: 0.85,
        },
        {
          url: "https://dead-domain.example/product",
          summary: JSON.stringify({ name: "Dead Domain", price: "$13.00" }),
          score: 0.80,
        },
      ]),
    );

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/gone")) return Promise.resolve({ status: 404 });
      if (url.includes("dead-domain")) return Promise.reject(new Error("getaddrinfo ENOTFOUND dead-domain.example"));
      return Promise.resolve({ status: 200 });
    });

    const results = await searchProducts("products");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(["Reachable A", "Reachable B"]);
  });

  it("returns empty array when all URLs are unreachable", async () => {
    mockSearchAndContents.mockResolvedValue(
      makeSearchResponse([
        {
          url: "https://example.com/gone-1",
          summary: JSON.stringify({ name: "Gone A", price: "$10.00" }),
        },
        {
          url: "https://example.com/gone-2",
          summary: JSON.stringify({ name: "Gone B", price: "$15.00" }),
        },
      ]),
    );

    mockFetch.mockResolvedValue({ status: 404 });

    const results = await searchProducts("products");
    expect(results).toHaveLength(0);
  });

  it("performs URL checks in parallel (all valid pass through)", async () => {
    const urls = Array.from({ length: 5 }, (_, i) => ({
      url: `https://example.com/product-${i}`,
      summary: JSON.stringify({ name: `Product ${i}`, price: `$${10 + i}.00` }),
      score: 0.9 - i * 0.05,
    }));

    mockSearchAndContents.mockResolvedValue(makeSearchResponse(urls));

    const fetchCalls: string[] = [];
    mockFetch.mockImplementation((url: string) => {
      fetchCalls.push(url);
      return Promise.resolve({ status: 200 });
    });

    const results = await searchProducts("products");
    expect(results).toHaveLength(5);
    // All 5 URLs should have been checked
    expect(fetchCalls).toHaveLength(5);
  });
});
