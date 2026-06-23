import { describe, it, expect } from "vitest";
import {
  scrapePrice,
  discoverViaCart,
  discoverPrice,
  scrapePriceWithOptions,
  discoverViaBrowser,
  discoverProduct,
  resolveVariantPricesViaBrowser,
} from "../src/discover.js";

const HAS_KEYS =
  !!process.env.BROWSERBASE_API_KEY && !!process.env.GOOGLE_API_KEY;

// ---- Tier 1: Server-side scrape against real sites ----

describe("Tier 1 scrape (real sites)", () => {
  it("scrapes a Shopify product via JSON-LD (Allbirds)", async () => {
    const result = await scrapePrice(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log("Allbirds:", JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    expect(result!.method).toBe("scrape");
    // Price should be a decimal like "100.00", not cents
    expect(parseFloat(result!.price)).toBeLessThan(1000);
  }, 30000);

  it("scrapes Hydrogen demo store via JSON-LD", async () => {
    const result = await scrapePrice(
      "https://hydrogen-preview.myshopify.com/products/the-full-stack",
    );
    console.log("Hydrogen:", JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    // Price should be normalized to dollars, not cents
    expect(parseFloat(result!.price)).toBeLessThan(10000);
  }, 30000);

  it("scrapes a Shopify store via JSON-LD (Gymshark)", async () => {
    const result = await scrapePrice(
      "https://www.gymshark.com/products/gymshark-crest-t-shirt-black-aw24",
    );
    console.log("Gymshark:", JSON.stringify(result, null, 2));
    // Gymshark may or may not be scrapeable — log either way
    if (result) {
      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
    }
  }, 30000);

  it("returns null for bot-blocked site (Best Buy)", async () => {
    const result = await scrapePrice(
      "https://www.bestbuy.com/site/apple-airpods-4-white/6447382.p",
    );
    console.log("BestBuy:", result);
    // Best Buy blocks server-side scraping — Tier 2 would be needed
    expect(result).toBeNull();
  }, 30000);
});

// ---- Tier 2: Browserbase cart discovery (requires API keys) ----

describe.skipIf(!HAS_KEYS)("Tier 2 discovery via cart (real sites)", () => {
  const testShipping = {
    name: "John Doe",
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
    email: "john@example.com",
    phone: "512-555-0100",
  };

  it("discovers price on Hydrogen demo Shopify store", async () => {
    const result = await discoverViaCart(
      "https://hydrogen-preview.myshopify.com/products/the-full-stack",
      testShipping,
    );
    console.log("Tier 2 Hydrogen:", JSON.stringify(result, null, 2));
    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();
    expect(result.method).toBe("browserbase_cart");
    // Price should be stripped of currency symbol
    expect(result.price).not.toContain("$");
  }, 120000);
});

// ---- discoverPrice: Tier 1 → Tier 2 fallback ----

describe.skipIf(!HAS_KEYS)("discoverPrice fallback (real sites)", () => {
  const testShipping = {
    name: "John Doe",
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
    email: "john@example.com",
    phone: "512-555-0100",
  };

  it("uses Tier 1 for Shopify sites with JSON-LD", async () => {
    const result = await discoverPrice(
      "https://www.allbirds.com/products/mens-tree-runners",
      testShipping,
    );
    console.log("discoverPrice Allbirds:", JSON.stringify(result, null, 2));
    expect(result.method).toBe("scrape"); // Should be fast Tier 1
    expect(result.price).toBeTruthy();
  }, 30000);
});

// ---- scrapePriceWithOptions: Tier 1 with variants (no API key needed) ----

describe("scrapePriceWithOptions (real sites)", () => {
  it("extracts name + price + options from Allbirds", async () => {
    const result = await scrapePriceWithOptions(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log(
      "scrapePriceWithOptions Allbirds:",
      JSON.stringify(result, null, 2),
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    expect(parseFloat(result!.price)).toBeGreaterThan(0);
    expect(parseFloat(result!.price)).toBeLessThan(1000);
    expect(Array.isArray(result!.options)).toBe(true);
  }, 30000);

  it("extracts name + price from Hydrogen demo store", async () => {
    const result = await scrapePriceWithOptions(
      "https://hydrogen-preview.myshopify.com/products/the-full-stack",
    );
    console.log(
      "scrapePriceWithOptions Hydrogen:",
      JSON.stringify(result, null, 2),
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    expect(parseFloat(result!.price)).toBeGreaterThan(0);
  }, 30000);
});

// ---- Tier 3: Browserbase product discovery (requires API keys) ----

describe.skipIf(!HAS_KEYS)("Tier 3 Browserbase discovery (real sites)", () => {
  it("extracts product data from Amazon bed sheets", async () => {
    const result = await discoverViaBrowser(
      "https://www.amazon.com/Amazon-Basics-Lightweight-Wrinkle-Free-Breathable/dp/B00Q7OAKV2",
    );
    console.log("Tier 3 Amazon:", JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.method).toBe("browserbase");

    const price = parseFloat(result!.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(200);

    // Amazon bed sheets should have Size and Color options
    if (result!.options.length > 0) {
      const optionNames = result!.options.map((o) => o.name.toLowerCase());
      console.log("Extracted option groups:", optionNames);
    }
  }, 120000);

  it("extracts product data from Best Buy AirPods", async () => {
    const result = await discoverViaBrowser(
      "https://www.bestbuy.com/site/apple-airpods-4-white/6447382.p",
    );
    console.log("Tier 3 Best Buy:", JSON.stringify(result, null, 2));

    // Best Buy may block headless browsers with captchas — null is acceptable
    if (!result) {
      console.warn(
        "Best Buy returned null — likely blocked by captcha/bot detection",
      );
      return;
    }

    expect(result.name).toBeTruthy();
    expect(result.method).toBe("browserbase");

    const price = parseFloat(result.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(500);
  }, 120000);
});

// ---- discoverProduct 3-tier pipeline ----

describe("discoverProduct pipeline (real sites)", () => {
  it("returns result from Firecrawl, scrape, or browserbase", async () => {
    const result = await discoverProduct(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log("discoverProduct Allbirds:", JSON.stringify(result, null, 2));
    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();
    expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);

    if (result.method === "firecrawl") {
      console.log("Firecrawl primary tier succeeded");
    } else if (result.method === "scrape") {
      console.log(
        "Fell back to scrape — Firecrawl may be unavailable",
      );
    } else {
      console.log("Fell back to browserbase Tier 3");
    }
  }, 30000);
});

// ---- Tier 3 variant price resolution (real sites) ----

describe.skipIf(!HAS_KEYS)(
  "Tier 3 variant price resolution (real sites)",
  () => {
    it("resolves per-variant prices for Amazon bed sheets", async () => {
      const result = await discoverViaBrowser(
        "https://www.amazon.com/Amazon-Basics-Lightweight-Wrinkle-Free-Breathable/dp/B00Q7OAKV2",
      );
      console.log(
        "Variant resolution Amazon:",
        JSON.stringify(result, null, 2),
      );

      expect(result).not.toBeNull();
      expect(result!.name).toBeTruthy();

      // Check that options with prices exist
      if (result!.options.length > 0) {
        const withPrices = result!.options.filter(
          (o) => o.prices && Object.keys(o.prices).length > 0,
        );
        console.log(
          "Option groups with per-variant prices:",
          withPrices.length,
        );
        for (const opt of withPrices) {
          console.log(`  ${opt.name}:`, JSON.stringify(opt.prices));
        }
      }
    }, 300000);

    it("resolves variant prices for Allbirds sizes", async () => {
      const options = [{ name: "Size", values: ["8", "9", "10"] }];

      const result = await resolveVariantPricesViaBrowser(
        "https://www.allbirds.com/products/mens-tree-runners",
        options,
        2,
      );

      console.log("Allbirds size resolution:", JSON.stringify(result, null, 2));
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("Size");
    }, 180000);
  },
);

describe.skipIf(!HAS_KEYS)("discoverProduct Amazon (real sites)", () => {
  it("discovers Amazon product via pipeline fallback to browserbase", async () => {
    const result = await discoverProduct(
      "https://www.amazon.com/Amazon-Basics-Lightweight-Wrinkle-Free-Breathable/dp/B00Q7OAKV2",
    );
    console.log("discoverProduct Amazon:", JSON.stringify(result, null, 2));
    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();

    const price = parseFloat(result.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(200);

    // Amazon blocks Firecrawl and scrape, so should fall through to browserbase
    // (unless Firecrawl improves its Amazon support)
    expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);
    console.log(`discoverProduct Amazon used method: ${result.method}`);
  }, 150000);
});
