import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ShippingInfo } from "@tomo/core";

// ---- Mock external packages ----

vi.mock("@tomo/checkout", () => ({
  discoverPrice: vi.fn(),
}));

import { discoverPrice } from "@tomo/checkout";
import { buy, normalizeSelections } from "../src/buy.js";

const mockedDiscoverPrice = vi.mocked(discoverPrice);

// ---- Test helpers ----

let tmpDir: string;

function setupConfig(): void {
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      default_order_expiry_seconds: 300,
      port: 3000,
    }),
  );
}

const testShipping: ShippingInfo = {
  name: "Test User",
  street: "123 Main St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  email: "test@test.com",
  phone: "+10001112222",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-buy-test-"));
  process.env.TOMO_DATA_DIR = tmpDir;
  setupConfig();
  vi.clearAllMocks();
  // Clear shipping defaults
  delete process.env.SHIPPING_NAME;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.TOMO_DATA_DIR;
});

// ---- Tests ----

describe("buy", () => {
  it("buy URL returns order with 2% fee", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Test Product",
      price: "17.99",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/product/123",
      shipping: testShipping,
    });

    expect(order.payment.price).toBe("17.99");
    expect(order.payment.fee).toBe("0.36");
    expect(order.payment.fee_rate).toBe("2%");
    expect(order.product.name).toBe("Test Product");
    expect(order.shipping).toEqual(testShipping);
    expect(order.status).toBe("awaiting_confirmation");
  });

  it("buy without shipping and no defaults throws SHIPPING_REQUIRED", async () => {
    await expect(
      buy({
        url: "https://shop.example.com/product/123",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "SHIPPING_REQUIRED" }));
  });

  it("buy without shipping uses env defaults", async () => {
    process.env.SHIPPING_NAME = "Default User";
    process.env.SHIPPING_STREET = "456 Elm St";
    process.env.SHIPPING_CITY = "Boulder";
    process.env.SHIPPING_STATE = "CO";
    process.env.SHIPPING_ZIP = "80301";
    process.env.SHIPPING_COUNTRY = "US";
    process.env.SHIPPING_EMAIL = "default@test.com";
    process.env.SHIPPING_PHONE = "+10009998888";

    mockedDiscoverPrice.mockResolvedValue({
      name: "Default Ship Product",
      price: "10.00",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/product/456",
    });

    expect(order.shipping).toBeDefined();
    expect(order.shipping!.name).toBe("Default User");
    expect(order.shipping!.city).toBe("Boulder");
  });

  it("buy with explicit shipping uses provided shipping", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Explicit Ship Product",
      price: "15.00",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/product/789",
      shipping: testShipping,
    });

    expect(order.shipping).toEqual(testShipping);
  });

  it("buy with selections stores them on order", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Sneaker",
      price: "19.99",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/sneaker",
      shipping: testShipping,
      selections: { Color: "Charcoal", Size: "10" },
    });

    expect(order.selections).toEqual({ Color: "Charcoal", Size: "10" });
  });

  it("buy with empty shipping.email throws MISSING_FIELD", async () => {
    await expect(
      buy({
        url: "https://shop.example.com/widget",
        shipping: { ...testShipping, email: "" },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "MISSING_FIELD" }),
    );
  });

  it("buy drops blank selection values instead of throwing", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Sneaker",
      price: "19.99",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/sneaker",
      shipping: testShipping,
      selections: { Size: "10", Color: "" },
    });

    // Blank "Color" is a no-choice option: dropped, not fatal.
    expect(order.selections).toEqual({ Size: "10" });
  });

  it("buy high-price product succeeds (no price cap)", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Expensive Item",
      price: "100.00",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/expensive",
      shipping: testShipping,
    });

    expect(order.payment.price).toBe("100.00");
    expect(order.payment.fee).toBe("2.00");
  });
});

describe("normalizeSelections", () => {
  it("drops a blank value and keeps the trimmed non-blank pair", () => {
    expect(normalizeSelections({ size: "10", color: "" })).toEqual({
      size: "10",
    });
  });

  it("drops whitespace-only values", () => {
    expect(normalizeSelections({ size: "10", color: "  " })).toEqual({
      size: "10",
    });
  });

  it("trims kept keys and values", () => {
    expect(normalizeSelections({ "  size  ": "  10  " })).toEqual({
      size: "10",
    });
  });

  it("throws INVALID_SELECTION for a non-string value", () => {
    expect(() =>
      // @ts-expect-error testing runtime guard against malformed input
      normalizeSelections({ size: 10 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SELECTION" }));
  });

  it("returns an empty object when all selections are blank", () => {
    expect(normalizeSelections({ size: "", color: "   " })).toEqual({});
  });

  it("returns an empty object for undefined input", () => {
    expect(normalizeSelections(undefined)).toEqual({});
  });

  it("does not mutate the input object", () => {
    const input = { size: "10", color: "" };
    normalizeSelections(input);
    expect(input).toEqual({ size: "10", color: "" });
  });
});
