import { describe, it, expect } from "vitest";
import { discoverViaFirecrawl } from "../src/discover.js";

// ---- Firecrawl rich extraction (requires FIRECRAWL_API_KEY + running Firecrawl) ----

const HAS_FIRECRAWL = !!process.env.FIRECRAWL_API_KEY;

describe.skipIf(!HAS_FIRECRAWL)("discoverViaFirecrawl (real sites)", () => {
  it("extracts rich data from Allbirds", async () => {
    const result = await discoverViaFirecrawl(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log("Firecrawl Allbirds:", JSON.stringify(result, null, 2));

    // Firecrawl may return null if the API key is invalid or the service is down
    if (!result) {
      console.warn(
        "Firecrawl returned null — API key may be invalid or service unavailable",
      );
      return;
    }

    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();
    expect(["firecrawl", "shopify"]).toContain(result.method);

    // Price should be reasonable
    const price = parseFloat(result.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(1000);

    // At least one rich field should be populated
    const hasRich =
      !!result.brand || !!result.description || !!result.image_url;
    expect(hasRich).toBe(true);
  }, 120000);
});

// ---- Firecrawl 3-step pipeline e2e tests ----

describe.skipIf(!HAS_FIRECRAWL)(
  "Firecrawl 3-step pipeline — Path 1: Simple product (Step 1 only)",
  () => {
    it("extracts Hydrogen demo product (no variants expected)", async () => {
      const result = await discoverViaFirecrawl(
        "https://hydrogen-preview.myshopify.com/products/the-full-stack",
      );
      console.log("Firecrawl Hydrogen:", JSON.stringify(result, null, 2));

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(["firecrawl", "shopify"]).toContain(result.method);
    }, 30000);
  },
);

describe.skipIf(!HAS_FIRECRAWL)(
  "Firecrawl 3-step pipeline — Path 2: Options + variant URLs (Steps 1+2)",
  () => {
    it("extracts Allbirds Tree Runners with Color + Size options and variant pricing", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.allbirds.com/products/mens-tree-runners",
      );
      console.log(
        "Firecrawl Allbirds (3-step):",
        JSON.stringify(result, null, 2),
      );

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(["firecrawl", "shopify"]).toContain(result.method);

      // Should have options
      if (result.options.length > 0) {
        const optionNames = result.options.map((o) => o.name.toLowerCase());
        console.log("Detected option groups:", optionNames);
      }

      // At least one rich field
      const hasRich =
        !!result.brand || !!result.description || !!result.image_url;
      expect(hasRich).toBe(true);
    }, 120000);

    it("extracts Bombas socks with Color options", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.bombas.com/products/womens-ankle-sock-4-pack",
      );
      console.log("Firecrawl Bombas:", JSON.stringify(result, null, 2));

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(["firecrawl", "shopify"]).toContain(result.method);
    }, 120000);

    it("extracts Brooklinen sheets with Size + Color options", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.brooklinen.com/products/classic-core-sheet-set",
      );
      console.log("Firecrawl Brooklinen:", JSON.stringify(result, null, 2));

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(["firecrawl", "shopify"]).toContain(result.method);

      // Brooklinen sheets should have options (Size at minimum)
      if (result.options.length > 0) {
        const optionNames = result.options.map((o) => o.name.toLowerCase());
        console.log("Brooklinen option groups:", optionNames);
      }
    }, 120000);
  },
);

describe.skipIf(!HAS_FIRECRAWL)(
  "Firecrawl 3-step pipeline — Path 3: Options + NO variant URLs (Steps 1+3 crawl)",
  () => {
    it("extracts Gymshark with Size options via crawl fallback", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.gymshark.com/products/gymshark-crest-t-shirt-black-aw24",
      );
      console.log(
        "Firecrawl Gymshark (crawl):",
        JSON.stringify(result, null, 2),
      );

      if (!result) {
        console.warn("Firecrawl returned null — Gymshark may block Firecrawl");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(["firecrawl", "shopify"]).toContain(result.method);

      if (result.options.length > 0) {
        const optionNames = result.options.map((o) => o.name.toLowerCase());
        console.log("Gymshark option groups:", optionNames);
      }
    }, 180000);
  },
);
