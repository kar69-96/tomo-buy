import { describe, it, expect, vi } from "vitest";

// ---- Mock external packages ----

vi.mock("@bloon/crawling", () => ({
  classifyUrl: vi.fn().mockReturnValue("exa_first"),
  discoverWithStrategy: vi.fn(),
}));

import { discoverWithStrategy } from "@bloon/crawling";
import { query } from "../src/query.js";

const mockedDiscoverWithStrategy = vi.mocked(discoverWithStrategy);

// ---- Tests ----

describe("query", () => {
  it("query URL returns product info + options + required_fields", async () => {
    mockedDiscoverWithStrategy.mockResolvedValue({
      name: "Cool Sneakers",
      price: "89.99",
      image_url: "https://shop.example.com/img.jpg",
      method: "exa",
      options: [
        { name: "Color", values: ["White", "Black"] },
        { name: "Size", values: ["9", "10", "11"] },
      ],
    });

    const result = await query({ url: "https://shop.example.com/sneakers" });

    expect(result.product.name).toBe("Cool Sneakers");
    expect(result.product.price).toBe("89.99");
    expect(result.options).toHaveLength(2);
    expect(result.options[0].name).toBe("Color");
    // 9 standard shipping fields + 1 selections field
    expect(result.required_fields).toHaveLength(10);
    expect(result.required_fields.find((f) => f.field === "selections")).toBeDefined();
  });

  it("query URL without options has no selections in required_fields", async () => {
    mockedDiscoverWithStrategy.mockResolvedValue({
      name: "Simple Widget",
      price: "10.00",
      method: "firecrawl",
      options: [],
    });

    const result = await query({ url: "https://shop.example.com/widget" });

    expect(result.required_fields.find((f) => f.field === "selections")).toBeUndefined();
    // 9 standard shipping fields
    expect(result.required_fields).toHaveLength(9);
  });

  it("query invalid URL throws INVALID_URL", async () => {
    await expect(query({ url: "not-a-url" })).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_URL" }),
    );
  });

  it("query with discovery failure throws QUERY_FAILED", async () => {
    mockedDiscoverWithStrategy.mockRejectedValue(new Error("Network timeout"));

    await expect(
      query({ url: "https://shop.example.com/timeout" }),
    ).rejects.toThrow(expect.objectContaining({ code: "QUERY_FAILED" }));
  });

  it("query with null discovery result throws QUERY_FAILED", async () => {
    mockedDiscoverWithStrategy.mockResolvedValue(null);

    await expect(
      query({ url: "https://shop.example.com/blocked" }),
    ).rejects.toThrow(expect.objectContaining({ code: "QUERY_FAILED" }));
  });
});
