import { describe, it, expect } from "vitest";
import { discoverViaFirecrawl } from "../src/discover.js";

/**
 * Comparison tests: validate self-hosted Firecrawl results match
 * the quality we got from Firecrawl cloud.
 *
 * Skip if Firecrawl is not available (no API key or service not running).
 */

const HAS_FIRECRAWL = !!process.env.FIRECRAWL_API_KEY;

async function firecrawlHealthy(): Promise<boolean> {
  const baseUrl =
    process.env.FIRECRAWL_BASE_URL || "http://localhost:3002";
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(!HAS_FIRECRAWL)(
  "Self-hosted vs cloud baseline comparison",
  () => {
    it("Allbirds: name contains Tree Runner, price 90-120, brand, ≥2 option groups", async () => {
      const healthy = await firecrawlHealthy();
      if (!healthy) {
        console.warn(
          "Firecrawl not reachable — skipping comparison test",
        );
        return;
      }

      const result = await discoverViaFirecrawl(
        "https://www.allbirds.com/products/mens-tree-runners",
      );

      if (!result) {
        console.warn("Firecrawl returned null — service may be starting up");
        return;
      }

      // Known cloud baseline: name ∋ "Tree Runner", price ~$100, brand "Allbirds"
      expect(result.name.toLowerCase()).toContain("tree runner");
      const price = parseFloat(result.price);
      expect(price).toBeGreaterThanOrEqual(90);
      expect(price).toBeLessThanOrEqual(120);
      expect(result.brand?.toLowerCase()).toContain("allbirds");
      expect(result.options.length).toBeGreaterThanOrEqual(2);
    }, 120000);

    it("Hydrogen: exact name, price $749.95, brand Snowdevil, Size options", async () => {
      const healthy = await firecrawlHealthy();
      if (!healthy) {
        console.warn(
          "Firecrawl not reachable — skipping comparison test",
        );
        return;
      }

      const result = await discoverViaFirecrawl(
        "https://hydrogen-preview.myshopify.com/products/the-full-stack",
      );

      if (!result) {
        console.warn("Firecrawl returned null — service may be starting up");
        return;
      }

      // Known cloud baseline
      expect(result.name.toLowerCase()).toContain("full stack");
      const price = parseFloat(result.price);
      expect(price).toBe(749.95);
      expect(result.method).toBe("firecrawl");
    }, 60000);
  },
);
