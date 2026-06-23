import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  discoverViaFirecrawl,
  discoverViaFirecrawlWithDiagnostics,
} from "../src/discover.js";
import { isValidPrice } from "../src/helpers.js";

// Use a test base URL for all Firecrawl mock tests
const TEST_BASE_URL = "https://api.firecrawl.dev";

// Valid markdown content that passes the blocked-page check (>= 50 chars)
const VALID_MD = "# Product Page\n\nThis is a real product page with enough content to pass validation checks.";
const VALID_META = { statusCode: 200 };

describe("discoverViaFirecrawl", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("returns null when FIRECRAWL_API_KEY not set", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when API returns non-OK", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response("error", { status: 500 })));
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns null when extract has no name/price", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: true, data: { json: { description: "A product" } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("maps all fields from full response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Tree Runner",
              price: "98.00",
              original_price: "120.00",
              currency: "USD",
              brand: "Allbirds",
              image_url: "https://img.com/main.jpg",
              description: "Lightweight running shoe",
              options: [
                {
                  name: "Size",
                  values: ["9", "10", "11"],
                  prices: { "9": "$89.00", "10": "$89.00", "11": "$95.00" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Tree Runner");
    expect(result!.price).toBe("98.00");
    expect(result!.original_price).toBe("120.00");
    expect(result!.currency).toBe("USD");
    expect(result!.brand).toBe("Allbirds");
    expect(result!.image_url).toBe("https://img.com/main.jpg");
    expect(result!.description).toBe("Lightweight running shoe");
    expect(result!.options).toHaveLength(1);
    expect(result!.options[0].name).toBe("Size");
    expect(result!.options[0].prices).toEqual({
      "9": "89.00",
      "10": "89.00",
      "11": "95.00",
    });
    expect(result!.method).toBe("firecrawl");
  });

  it("strips currency symbol from price", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { markdown: VALID_MD, metadata: VALID_META, json: { name: "Widget", price: "$99.99" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result!.price).toBe("99.99");
  });

  it("returns empty options when not in extract", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { markdown: VALID_MD, metadata: VALID_META, json: { name: "Simple Item", price: "10.00" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result!.options).toEqual([]);
  });

  it("strips currency from option prices", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Sneaker",
              price: "$120.00",
              options: [
                {
                  name: "Size",
                  values: ["9", "10"],
                  prices: { "9": "$110.00", "10": "€120.00" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.options[0].prices).toEqual({
      "9": "110.00",
      "10": "120.00",
    });
  });

  it("sends POST to /v1/scrape with correct body", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { markdown: VALID_MD, metadata: VALID_META, json: { name: "Test", price: "10.00" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(fetchSpy).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v1/scrape`,
      expect.objectContaining({
        method: "POST",
      }),
    );

    // Verify body contains url, formats, jsonOptions
    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.url).toBe("https://example.com/product");
    expect(body.formats).toEqual(["json", "markdown"]);
    expect(body.jsonOptions).toBeDefined();
    expect(body.jsonOptions.schema).toBeDefined();
    expect(body.jsonOptions.prompt).toBeDefined();
  });
});

// ---- Scrape error handling tests (replaces async polling) ----

describe("discoverViaFirecrawl — scrape error handling", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("returns null when scrape response indicates failure", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns null when fetch rejects (e.g. timeout)", async () => {
    fetchSpy.mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns data directly without polling (synchronous scrape)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { markdown: VALID_MD, metadata: VALID_META, json: { name: "Sync Product", price: "29.99" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Sync Product");

    // Only one fetch call (no polling)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---- Step 2: Variant URL resolution via /scrape ----

describe("discoverViaFirecrawl — Step 2: variant URL resolution", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Default fallback for unmocked calls (Exa, browserbase, etc.)
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("resolves per-variant prices from variant URLs", async () => {
    // Step 1: product with options + variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Sneaker",
              price: "$100.00",
              options: [{ name: "Color", values: ["Red", "Blue"] }],
              variant_urls: [
                "https://example.com/sneaker-red",
                "https://example.com/sneaker-blue",
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 2: variant URL extracts
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Sneaker - Red",
              price: "$95.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Sneaker - Blue",
              price: "$110.00",
              options: [{ name: "Color", values: ["Blue"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/sneaker");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(1);

    const colorOpt = result!.options[0];
    expect(colorOpt.name).toBe("Color");
    expect(colorOpt.prices).toBeDefined();
    expect(colorOpt.prices!["Red"]).toBe("95.00");
    expect(colorOpt.prices!["Blue"]).toBe("110.00");
  });

  it("caps variant URLs at MAX_VARIANT_EXTRACT (20)", async () => {
    const manyUrls = Array.from(
      { length: 25 },
      (_, i) => `https://example.com/variant-${i}`,
    );

    // Step 1: product with 25 variant URLs
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Product",
              price: "$50.00",
              options: [{ name: "Color", values: ["A"] }],
              variant_urls: manyUrls,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Mock all variant extracts to return null (we're just counting calls)
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data: { markdown: VALID_MD, metadata: VALID_META, json: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await discoverViaFirecrawl("https://example.com/product");

    // 1 (Step 1) + 20 (capped variant URLs) = 21 total calls
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(21);
  });

  it("omits prices when all variants have same price (same-price filter)", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Shirt",
              price: "$30.00",
              options: [{ name: "Color", values: ["Red", "Blue"] }],
              variant_urls: [
                "https://example.com/shirt-red",
                "https://example.com/shirt-blue",
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Both variants return same price
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Shirt",
              price: "$30.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Shirt",
              price: "$30.00",
              options: [{ name: "Color", values: ["Blue"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/shirt");
    expect(result).not.toBeNull();
    const colorOpt = result!.options[0];
    expect(colorOpt.prices).toBeUndefined();
  });

  it("handles variant extract failure gracefully for some URLs", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Shoe",
              price: "$80.00",
              options: [{ name: "Color", values: ["Red", "Blue", "Green"] }],
              variant_urls: [
                "https://example.com/shoe-red",
                "https://example.com/shoe-blue",
                "https://example.com/shoe-green",
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Red succeeds
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Shoe",
              price: "$80.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    // Blue fails
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));
    // Green succeeds with different price
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Shoe",
              price: "$90.00",
              options: [{ name: "Color", values: ["Green"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/shoe");
    expect(result).not.toBeNull();
    const colorOpt = result!.options[0];
    // Should still have prices from successful extracts
    expect(colorOpt.prices).toBeDefined();
    expect(colorOpt.prices!["Red"]).toBe("80.00");
    expect(colorOpt.prices!["Green"]).toBe("90.00");
    // Blue was not resolved
    expect(colorOpt.prices!["Blue"]).toBeUndefined();
  });
});

// ---- Step 3: Crawl fallback ----

describe("discoverViaFirecrawl — Step 3: crawl fallback", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Default fallback for unmocked calls (Exa, browserbase, etc.)
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("triggers crawl when options exist but no variant_urls", async () => {
    // Step 1: options but no variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Crest T-Shirt",
              price: "$25.00",
              options: [{ name: "Size", values: ["S", "M", "L"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 3: /crawl returns async job
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Poll: completed with relevant pages
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              extract: {
                name: "Crest T-Shirt Black",
                price: "$25.00",
                options: [{ name: "Size", values: ["S"] }],
              },
            },
            {
              extract: {
                name: "Crest T-Shirt White",
                price: "$30.00",
                options: [{ name: "Size", values: ["M"] }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/tshirt");
    expect(result).not.toBeNull();

    // Verify /crawl was called (second fetch call)
    expect(fetchSpy.mock.calls[1]![0]).toBe(
      `${TEST_BASE_URL}/v1/crawl`,
    );

    const sizeOpt = result!.options[0];
    expect(sizeOpt.name).toBe("Size");
    expect(sizeOpt.prices).toBeDefined();
    expect(sizeOpt.prices!["S"]).toBe("25.00");
    expect(sizeOpt.prices!["M"]).toBe("30.00");
  });

  it("filters crawled pages with different product names", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Classic Core Sheet Set",
              price: "$100.00",
              options: [{ name: "Size", values: ["Twin", "Queen"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Crawl
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-002" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              extract: {
                name: "Classic Core Sheet Set - Twin",
                price: "$90.00",
                options: [{ name: "Size", values: ["Twin"] }],
              },
            },
            {
              extract: {
                name: "Completely Different Product - Pillow",
                price: "$50.00",
                options: [{ name: "Size", values: ["Queen"] }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/sheets");
    expect(result).not.toBeNull();

    const sizeOpt = result!.options[0];
    // Only the matching product page should contribute
    expect(sizeOpt.prices).toBeUndefined(); // Only one matching page, can't build multi-price map
  });

  it("returns options without prices when crawl returns all same prices", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Uniform Product",
              price: "$50.00",
              options: [{ name: "Color", values: ["Red", "Blue"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Crawl
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-003" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              extract: {
                name: "Uniform Product Red",
                price: "$50.00",
                options: [{ name: "Color", values: ["Red"] }],
              },
            },
            {
              extract: {
                name: "Uniform Product Blue",
                price: "$50.00",
                options: [{ name: "Color", values: ["Blue"] }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    const colorOpt = result!.options[0];
    expect(colorOpt.prices).toBeUndefined();
  });

  it("degrades gracefully when crawl times out", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Timeout Product",
              price: "$40.00",
              options: [{ name: "Size", values: ["S", "M"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Crawl POST
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-timeout" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // All polls: still processing (timeout)
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "processing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Timeout Product");
    // Options returned without prices (graceful degradation)
    expect(result!.options).toHaveLength(1);
    expect(result!.options[0].prices).toBeUndefined();
  }, 180_000);
});

// ---- Pipeline routing tests ----

describe("discoverViaFirecrawl — pipeline routing", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("only runs Step 1 when no options found", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { markdown: VALID_MD, metadata: VALID_META, json: { name: "Simple Product", price: "$10.00" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.options).toEqual([]);
    // Only one fetch call (Step 1)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("runs Step 2 when options + variant_urls, does NOT crawl", async () => {
    // Step 1: options + variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Product",
              price: "$50.00",
              options: [{ name: "Color", values: ["Red"] }],
              variant_urls: ["https://example.com/product-red"],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 2: variant URL extract
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Product Red",
              price: "$50.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await discoverViaFirecrawl("https://example.com/product");

    // Step 1 + Step 2 variant extract = 2 calls (no /crawl)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Verify no /crawl call
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain("/v1/crawl");
    }
  });

  it("runs Step 3 (crawl) when options + no variant_urls", async () => {
    // Step 1: options but no variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Product",
              price: "$50.00",
              options: [{ name: "Size", values: ["S", "M"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 3: crawl POST
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-routing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Crawl poll: completed with empty data
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "completed", data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await discoverViaFirecrawl("https://example.com/product");

    // Verify /crawl was called
    expect(String(fetchSpy.mock.calls[1]![0])).toContain("/v1/crawl");
  });
});

// ---- Field passthrough tests ----

describe("discoverViaFirecrawl — field passthrough", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("passes description from extract to result", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Product",
              price: "10.00",
              description: "A great product for everyone",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.description).toBe("A great product for everyone");
  });

  it("passes brand, image_url, currency, original_price correctly", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: {
              name: "Premium Widget",
              price: "$99.99",
              original_price: "$149.99",
              currency: "EUR",
              brand: "WidgetCo",
              image_url: "https://img.example.com/widget.jpg",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/widget");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("WidgetCo");
    expect(result!.image_url).toBe("https://img.example.com/widget.jpg");
    expect(result!.currency).toBe("EUR");
    expect(result!.original_price).toBe("149.99");
    expect(result!.price).toBe("99.99");
  });
});

// ---- Retry behavior + timeout tests ----

describe("discoverViaFirecrawl — retry and timeout", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("retries with exponential backoff when first attempt returns null result", async () => {
    // First call: returns blocked page (null result)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Blocked", price: "$50.00" },
            markdown: "Just a moment... Checking your browser.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Second call (retry 1): also blocked
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Blocked", price: "$50.00" },
            markdown: "Just a moment... Checking your browser.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Third call (retry 2): returns valid data
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: { name: "Real Product", price: "$50.00" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Real Product");
    // Three fetch calls: initial + 2 retries
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("returns null when all 3 attempts fail", async () => {
    // All calls return blocked page
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Blocked", price: "$50.00" },
            markdown: "Access Denied - automated access not permitted.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );

    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
    // At least 1 Firecrawl attempt detects "blocked", plus possible retries/Browserbase fallback
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not retry when first attempt succeeds", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: { name: "Quick Product", price: "$25.00" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Quick Product");
    // Only one fetch call — no retry needed
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes 90s timeout to firecrawl scrape", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: { name: "Test", price: "10.00" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await discoverViaFirecrawl("https://example.com/product");

    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.timeout).toBe(90000);
  });

  it("passes waitFor: 0 to firecrawl scrape (adapter handles waiting)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: VALID_MD,
            metadata: VALID_META,
            json: { name: "Test", price: "10.00" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await discoverViaFirecrawl("https://example.com/product");

    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.waitFor).toBe(0);
  });
});

// ---- isValidPrice unit tests ----

describe("isValidPrice", () => {
  it("rejects NaN", () => {
    expect(isValidPrice("NaN")).toBe(false);
  });

  it("rejects a lone dot", () => {
    expect(isValidPrice(".")).toBe(false);
  });

  it("rejects $0.00", () => {
    expect(isValidPrice("$0.00")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidPrice("")).toBe(false);
  });

  it("rejects $NaN", () => {
    expect(isValidPrice("$NaN")).toBe(false);
  });

  it("accepts 99.99", () => {
    expect(isValidPrice("99.99")).toBe(true);
  });

  it("accepts $29.00", () => {
    expect(isValidPrice("$29.00")).toBe(true);
  });

  it("accepts 0.01 (lowest valid price)", () => {
    expect(isValidPrice("0.01")).toBe(true);
  });
});

// ---- Invalid price rejection in pipeline ----

describe("discoverViaFirecrawl — invalid price rejection", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("returns null when price is NaN", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Product", price: "NaN" },
            markdown: "# Product\nA real product page with content that is long enough.",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    );
    // Mock Browserbase adapter response (triggered by widened Browserbase fallback)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not available" }), { status: 502 }),
    );
    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
  });

  it("returns null when price is $0.00", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Free Thing", price: "$0.00" },
            markdown: "# Free Thing\nThis product is free and has enough content here.",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    // Mock Browserbase adapter response (triggered by widened Browserbase fallback)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not available" }), { status: 502 }),
    );
    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
  });
});

// ---- Blocked/empty page detection ----

describe("discoverViaFirecrawl — blocked page detection", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("returns null when page returns 403 (Cloudflare)", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "PUMA Shuffle", price: "$65.00" },
            markdown: "",
            metadata: { statusCode: 403 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns product_not_found when page returns 404", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Razer Blade", price: "$2499.99" },
            markdown: "",
            metadata: { statusCode: 404 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.error).toBe("product_not_found");
    expect(result!.name).toBe("");
    expect(result!.price).toBe("");
  });

  it("returns product_not_found when content says product discontinued", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Old Product", price: "$29.99" },
            markdown: "Sorry, this product is no longer available. Check out our other products.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.error).toBe("product_not_found");
  });

  it("returns product_not_found for HTTP 410 Gone", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Removed Item", price: "$15.00" },
            markdown: "",
            metadata: { statusCode: 410 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.error).toBe("product_not_found");
  });

  it("returns null when markdown is empty (page didn't render)", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Hallucinated Product", price: "$99.00" },
            markdown: "",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns null for bot-challenge page (Just a moment...)", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Fake Product", price: "$50.00" },
            markdown: "Just a moment... Checking your browser before accessing the site.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("classifies challenge pages as blocked (not not_found)", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Fake Product", price: "$50.00" },
            markdown: "Access denied. Page not found.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawlWithDiagnostics(
      "https://example.com/product",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const { result, diagnostics } = await promise;
    expect(result).toBeNull();
    expect(diagnostics.failureCode).toBe("blocked");
  });

  it("returns null for Access Denied page", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Blocked Product", price: "$120.00" },
            markdown: "Access Denied\nYou don't have permission to access this resource.",
            metadata: { statusCode: 403 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns valid result for 200 with real content", async () => {
    const realContent = "# Tree Runner\n\nLightweight running shoe made from eucalyptus tree fiber. "
      + "Perfect for everyday wear. Available in multiple sizes and colors. "
      + "Machine washable. Carbon neutral. Price: $98.00. Free shipping on orders over $75.";
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Tree Runner", price: "$98.00" },
            markdown: realContent,
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const promise = discoverViaFirecrawl("https://example.com/product");
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Tree Runner");
    expect(result!.price).toBe("98.00");
  });
});

describe("discoverViaFirecrawl diagnostics", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
  });

  it("returns llm_config code when FIRECRAWL_API_KEY is missing", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const { result, diagnostics } = await discoverViaFirecrawlWithDiagnostics(
      "https://example.com/product",
    );
    expect(result).toBeNull();
    expect(diagnostics.failureCode).toBe("llm_config");
    expect(diagnostics.failureStage).toBe("config");
  });
});

// ---- Concurrency isolation tests ----
// These verify that concurrent discovery requests don't corrupt each other's
// results or diagnostics via shared mutable state.

describe("discoverViaFirecrawl — concurrency isolation", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 })),
    );
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("concurrent requests each get their own correct product data", async () => {
    // Mock returns different products based on the URL in the request body
    fetchSpy.mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const requestUrl = body.url as string;

      // Simulate slight delay to increase interleaving likelihood
      await new Promise((r) => setTimeout(r, Math.random() * 10));

      if (requestUrl.includes("product-a")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              json: { name: "Product A", price: "$10.00" },
              markdown: "# Product A\n\nThis is product A with enough content to pass validation checks.",
              metadata: { statusCode: 200 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requestUrl.includes("product-b")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              json: { name: "Product B", price: "$20.00" },
              markdown: "# Product B\n\nThis is product B with enough content to pass validation checks.",
              metadata: { statusCode: 200 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requestUrl.includes("product-c")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              json: { name: "Product C", price: "$30.00" },
              markdown: "# Product C\n\nThis is product C with enough content to pass validation checks.",
              metadata: { statusCode: 200 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    // Fire all three concurrently
    const [resultA, resultB, resultC] = await Promise.all([
      discoverViaFirecrawl("https://example.com/product-a"),
      discoverViaFirecrawl("https://example.com/product-b"),
      discoverViaFirecrawl("https://example.com/product-c"),
    ]);

    // Each request must get its own product — no cross-contamination
    expect(resultA).not.toBeNull();
    expect(resultA!.name).toBe("Product A");
    expect(resultA!.price).toBe("10.00");

    expect(resultB).not.toBeNull();
    expect(resultB!.name).toBe("Product B");
    expect(resultB!.price).toBe("20.00");

    expect(resultC).not.toBeNull();
    expect(resultC!.name).toBe("Product C");
    expect(resultC!.price).toBe("30.00");
  });

  it("concurrent requests with mixed success/failure get correct diagnostics", async () => {
    // Blocked/error paths trigger retry backoff (2s+4s) and Browserbase fallback,
    // so this test needs more time than the default 5s.
    fetchSpy.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const fetchUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

      // Browserbase adapter fallback calls go to localhost — reject them fast
      if (fetchUrl.includes("localhost")) {
        return new Response("adapter not running", { status: 502 });
      }

      const body = JSON.parse((init?.body as string) ?? "{}");
      const requestUrl = body.url as string;

      await new Promise((r) => setTimeout(r, Math.random() * 10));

      if (requestUrl.includes("success")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              json: { name: "Good Product", price: "$50.00" },
              markdown: "# Good Product\n\nThis is a valid product page with enough content here.",
              metadata: { statusCode: 200 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requestUrl.includes("blocked")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              json: { name: "Blocked", price: "$99.00" },
              markdown: "Just a moment... Checking your browser before accessing the site. Please wait.",
              metadata: { statusCode: 200 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requestUrl.includes("error")) {
        return new Response("server error", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    });

    const [
      { result: successResult, diagnostics: successDiag },
      { result: blockedResult, diagnostics: blockedDiag },
      { result: errorResult, diagnostics: errorDiag },
    ] = await Promise.all([
      discoverViaFirecrawlWithDiagnostics("https://example.com/success"),
      discoverViaFirecrawlWithDiagnostics("https://example.com/blocked"),
      discoverViaFirecrawlWithDiagnostics("https://example.com/error"),
    ]);

    // Success request must succeed regardless of concurrent failures
    expect(successResult).not.toBeNull();
    expect(successResult!.name).toBe("Good Product");
    expect(successResult!.price).toBe("50.00");

    // Blocked request must report "blocked", not "http_error" from the error request
    expect(blockedResult).toBeNull();
    expect(blockedDiag.failureCode).toBe("blocked");

    // Error request must NOT report "blocked" — it should report its own failure.
    // After Firecrawl 500s (http_error), it falls back to Browserbase which also
    // fails (adapter_502). adapter_502 has higher priority so it wins.
    expect(errorResult).toBeNull();
    expect(errorDiag.failureCode).not.toBe("blocked");
    expect(["http_error", "adapter_502"]).toContain(errorDiag.failureCode);
  }, 30_000);

  it("10 concurrent identical requests all return the same correct result", async () => {
    fetchSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            json: { name: "Popular Item", price: "$42.00" },
            markdown: "# Popular Item\n\nA very popular product with enough content for validation.",
            metadata: { statusCode: 200 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        discoverViaFirecrawl(`https://example.com/popular-item?v=${i}`),
      ),
    );

    // Every single result must be correct — no nulls, no wrong data
    for (let i = 0; i < 10; i++) {
      expect(results[i]).not.toBeNull();
      expect(results[i]!.name).toBe("Popular Item");
      expect(results[i]!.price).toBe("42.00");
    }
  });
});
