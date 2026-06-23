import { describe, it, expect } from "vitest";
import {
  extractJsonLd,
  extractMetaTag,
  scrapePrice,
  extractVariantsFromJsonLd,
} from "../src/discover.js";

describe("extractJsonLd", () => {
  it("extracts Product from JSON-LD", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@type": "Product", "name": "Test Widget", "offers": {"price": "19.99"}}
      </script>
      </head></html>
    `;
    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!["@type"]).toBe("Product");
    expect(result!["name"]).toBe("Test Widget");
  });

  it("extracts Product from @graph array", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@graph": [
        {"@type": "WebSite", "name": "My Shop"},
        {"@type": "Product", "name": "Widget Pro", "offers": {"price": "29.99"}}
      ]}
      </script>
      </head></html>
    `;
    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!["name"]).toBe("Widget Pro");
  });

  it("returns null when no JSON-LD found", () => {
    const html = "<html><head><title>No JSON-LD</title></head></html>";
    expect(extractJsonLd(html)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{invalid json}</script>
      </head></html>
    `;
    expect(extractJsonLd(html)).toBeNull();
  });

  it("returns null when JSON-LD has no Product type", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@type": "WebSite", "name": "My Site"}
      </script>
      </head></html>
    `;
    expect(extractJsonLd(html)).toBeNull();
  });
});

describe("extractMetaTag", () => {
  it("extracts og:title", () => {
    const html = `<meta property="og:title" content="Cool Product">`;
    expect(extractMetaTag(html, "og:title")).toBe("Cool Product");
  });

  it("extracts product:price:amount", () => {
    const html = `<meta property="product:price:amount" content="24.99">`;
    expect(extractMetaTag(html, "product:price:amount")).toBe("24.99");
  });

  it("handles reversed attribute order", () => {
    const html = `<meta content="Test Name" property="og:title">`;
    expect(extractMetaTag(html, "og:title")).toBe("Test Name");
  });

  it("returns null for missing tag", () => {
    const html = `<meta property="og:description" content="Some desc">`;
    expect(extractMetaTag(html, "og:title")).toBeNull();
  });
});

describe("scrapePrice", () => {
  it("returns null for non-existent URL", async () => {
    const result = await scrapePrice(
      "https://this-domain-should-not-exist-12345.com/product",
    );
    expect(result).toBeNull();
  });
});

describe("extractVariantsFromJsonLd", () => {
  it("extracts options from hasVariant array", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Sneaker",
      hasVariant: [
        {
          additionalProperty: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "10" },
          ],
        },
        {
          additionalProperty: [
            { name: "Color", value: "Blue" },
            { name: "Size", value: "11" },
          ],
        },
      ],
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    expect(options).toHaveLength(2);

    const colorOpt = options.find((o) => o.name === "Color");
    expect(colorOpt).toBeDefined();
    expect(colorOpt!.values).toContain("Red");
    expect(colorOpt!.values).toContain("Blue");

    const sizeOpt = options.find((o) => o.name === "Size");
    expect(sizeOpt).toBeDefined();
    expect(sizeOpt!.values).toContain("10");
    expect(sizeOpt!.values).toContain("11");
  });

  it("extracts options from offers.additionalProperty (Shopify-style)", () => {
    const jsonLd = {
      "@type": "Product",
      name: "T-Shirt",
      offers: [
        {
          price: "29.99",
          additionalProperty: [
            { name: "Color", value: "Black" },
            { name: "Size", value: "M" },
          ],
        },
        {
          price: "29.99",
          additionalProperty: [
            { name: "Color", value: "White" },
            { name: "Size", value: "L" },
          ],
        },
      ],
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    expect(options).toHaveLength(2);

    const colorOpt = options.find((o) => o.name === "Color");
    expect(colorOpt!.values).toEqual(
      expect.arrayContaining(["Black", "White"]),
    );
    // Same price for all variants → no prices map
    expect(colorOpt!.prices).toBeUndefined();
  });

  it("extracts from single offers object (not array)", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Hat",
      offers: {
        price: "15.00",
        additionalProperty: [{ name: "Size", value: "One Size" }],
      },
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe("Size");
    expect(options[0].values).toEqual(["One Size"]);
  });

  it("returns empty array when no variants found", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Simple Product",
      offers: { price: "10.00" },
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    expect(options).toEqual([]);
  });

  it("deduplicates variant values", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Widget",
      hasVariant: [
        { additionalProperty: [{ name: "Color", value: "Red" }] },
        { additionalProperty: [{ name: "Color", value: "Red" }] },
        { additionalProperty: [{ name: "Color", value: "Blue" }] },
      ],
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    expect(options).toHaveLength(1);
    expect(options[0].values).toHaveLength(2);
  });

  it("extracts per-variant pricing from offers with different prices", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Running Shoe",
      offers: [
        {
          price: "89.99",
          additionalProperty: [
            { name: "Size", value: "9" },
            { name: "Color", value: "Red" },
          ],
        },
        {
          price: "99.99",
          additionalProperty: [
            { name: "Size", value: "12" },
            { name: "Color", value: "Red" },
          ],
        },
        {
          price: "89.99",
          additionalProperty: [
            { name: "Size", value: "9" },
            { name: "Color", value: "Blue" },
          ],
        },
      ],
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    const sizeOpt = options.find((o) => o.name === "Size");
    expect(sizeOpt).toBeDefined();
    expect(sizeOpt!.prices).toBeDefined();
    expect(sizeOpt!.prices!["9"]).toBe("89.99");
    expect(sizeOpt!.prices!["12"]).toBe("99.99");

    // Color has same price for all variants → no prices map
    const colorOpt = options.find((o) => o.name === "Color");
    expect(colorOpt).toBeDefined();
    expect(colorOpt!.prices).toBeUndefined();
  });

  it("omits prices when all variants have the same price", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Hat",
      offers: [
        {
          price: "25.00",
          additionalProperty: [{ name: "Color", value: "Red" }],
        },
        {
          price: "25.00",
          additionalProperty: [{ name: "Color", value: "Blue" }],
        },
      ],
    };

    const options = extractVariantsFromJsonLd(jsonLd);
    expect(options).toHaveLength(1);
    expect(options[0].prices).toBeUndefined();
  });
});
