/**
 * TDD: Browser renderer integration test.
 *
 * Tests the thin Browserbase adapter wrapper that renders JS-heavy pages.
 * Requires the Browserbase adapter running on port 3003.
 */

import { describe, it, expect } from "vitest";
import { renderPage } from "../src/browser-renderer.js";

const hasBrowserbase =
  !!process.env.BROWSERBASE_API_KEY && !!process.env.BROWSERBASE_PROJECT_ID;

describe.skipIf(!hasBrowserbase)("renderPage — integration", () => {
  it("renders a Shopify product page and returns complete HTML", async () => {
    const result = await renderPage("https://www.allbirds.com/products/mens-tree-runners");

    // Content check
    expect(result.html.length).toBeGreaterThan(1000);
    expect(result.html.toLowerCase()).toContain("allbirds");
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("</html>");

    // URL check
    expect(result.finalUrl).toContain("allbirds.com");
  }, 90_000);
});
