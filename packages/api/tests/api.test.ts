import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Order, Receipt } from "@bloon/core";

// ---- Mock external packages ----

vi.mock("@bloon/orchestrator", () => ({
  buy: vi.fn(),
  confirm: vi.fn(),
  query: vi.fn(),
  searchQuery: vi.fn(),
}));

import { buy, confirm, query, searchQuery } from "@bloon/orchestrator";
import { createApp } from "../src/server.js";

const mockedBuy = vi.mocked(buy);
const mockedConfirm = vi.mocked(confirm);
const mockedQuery = vi.mocked(query);
const mockedSearchQuery = vi.mocked(searchQuery);

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

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

function setupOrder(overrides: Partial<Order> = {}): Order {
  const order: Order = {
    order_id: "bloon_ord_test01",
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://shop.example.com/product/123",
      price: "17.99",
      source: "scrape",
    },
    payment: {
      total: "18.35",
      price: "17.99",
      fee: "0.36",
      fee_rate: "2%",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };

  const ordersPath = path.join(tmpDir, "orders.json");
  let store: { orders: Order[] };
  try {
    store = JSON.parse(fs.readFileSync(ordersPath, "utf-8"));
  } catch {
    store = { orders: [] };
  }
  store.orders.push(order);
  fs.writeFileSync(ordersPath, JSON.stringify(store));
  return order;
}

async function req(method: string, pathStr: string, body?: unknown) {
  const url = `http://localhost${pathStr}`;
  const init: RequestInit = { method, headers: {} };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(url, init);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-api-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
  setupConfig();
  vi.clearAllMocks();
  app = createApp();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BLOON_DATA_DIR;
});

// ---- POST /api/buy ----

describe("POST /api/buy", () => {
  it("returns buy quote with 200", async () => {
    const fakeOrder: Order = {
      order_id: "bloon_ord_buy01",
      status: "awaiting_confirmation",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
        price: "10.00",
        source: "scrape",
      },
      payment: {
        total: "10.20",
        price: "10.00",
        fee: "0.20",
        fee_rate: "2%",
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    };
    mockedBuy.mockResolvedValue(fakeOrder);

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/widget",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("bloon_ord_buy01");
    expect(json.product.name).toBe("Widget");
    expect(json.product.source).toBe("shop.example.com");
    expect(json.payment.item_price).toBe("10.00");
    expect(json.payment.fee).toBe("0.20");
    expect(json.payment.total).toBe("10.20");
    expect(json.status).toBe("awaiting_confirmation");
    expect(json.expires_in).toBeGreaterThan(0);
  });

  it("returns 400 MISSING_FIELD when url is missing", async () => {
    const res = await req("POST", "/api/buy", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("propagates INVALID_URL from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.INVALID_URL, "Invalid URL"),
    );

    const res = await req("POST", "/api/buy", {
      url: "not-a-url",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_URL");
  });
});

// ---- POST /api/confirm ----

describe("POST /api/confirm", () => {
  it("returns completed order with receipt on success", async () => {
    const receipt: Receipt = {
      product: "Widget",
      merchant: "shop.example.com",
      price: "10.00",
      fee: "0.20",
      total_paid: "10.20",
      timestamp: "2026-02-20T03:00:00.000Z",
      order_number: "ORD-123",
    };

    const completedOrder: Order = {
      order_id: "bloon_ord_conf01",
      status: "completed",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
        price: "10.00",
        source: "scrape",
      },
      payment: {
        total: "10.20",
        price: "10.00",
        fee: "0.20",
        fee_rate: "2%",
      },
      receipt,
      created_at: "2026-02-20T02:00:00.000Z",
      expires_at: "2026-02-20T02:05:00.000Z",
      confirmed_at: "2026-02-20T02:01:00.000Z",
      completed_at: "2026-02-20T03:00:00.000Z",
    };

    mockedConfirm.mockResolvedValue({ order: completedOrder, receipt });

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_conf01",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("bloon_ord_conf01");
    expect(json.status).toBe("completed");
    expect(json.receipt.product).toBe("Widget");
    expect(json.receipt.order_number).toBe("ORD-123");
  });

  it("returns 400 MISSING_FIELD when order_id is missing", async () => {
    const res = await req("POST", "/api/confirm", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("propagates ORDER_NOT_FOUND from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.ORDER_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_bad",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("propagates ORDER_EXPIRED from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.ORDER_EXPIRED, "Expired"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_expired",
    });
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_EXPIRED");
  });

  it("returns 200 with failed status when checkout failed", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");

    // Set up a failed order in the store
    setupOrder({
      order_id: "bloon_ord_fail01",
      status: "failed",
      error: {
        code: "CHECKOUT_FAILED",
        message: "Checkout timed out",
      },
    });

    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.CHECKOUT_FAILED, "Checkout timed out"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_fail01",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("bloon_ord_fail01");
    expect(json.status).toBe("failed");
    expect(json.error.code).toBe("CHECKOUT_FAILED");
  });

  it("returns existing receipt for already completed order", async () => {
    const receipt: Receipt = {
      product: "Already Done",
      merchant: "shop.example.com",
      price: "5.00",
      fee: "0.10",
      total_paid: "5.10",
      timestamp: "2026-02-20T00:00:00.000Z",
    };

    const order: Order = {
      order_id: "bloon_ord_already",
      status: "completed",
      product: {
        name: "Already Done",
        url: "https://shop.example.com/done",
        price: "5.00",
        source: "scrape",
      },
      payment: {
        total: "5.10",
        price: "5.00",
        fee: "0.10",
        fee_rate: "2%",
      },
      receipt,
      created_at: "2026-02-20T00:00:00.000Z",
      expires_at: "2026-02-20T00:05:00.000Z",
    };

    mockedConfirm.mockResolvedValue({ order, receipt });

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_already",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
  });
});

// ---- POST /api/query ----

describe("POST /api/query", () => {
  it("returns 200 with product, options, required_fields", async () => {
    mockedQuery.mockResolvedValue({
      product: {
        name: "Cool Shoes",
        url: "https://shop.example.com/shoes",
        price: "89.99",
        image_url: "https://shop.example.com/shoes.jpg",
      },
      options: [{ name: "Size", values: ["9", "10", "11"] }],
      required_fields: [
        { field: "shipping.email", label: "Email" },
        { field: "selections", label: "Product options (Size)" },
      ],
      discovery_method: "scrape",
    });

    const res = await req("POST", "/api/query", {
      url: "https://shop.example.com/shoes",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.product.name).toBe("Cool Shoes");
    expect(json.product.source).toBe("shop.example.com");
    expect(json.options).toHaveLength(1);
    expect(json.options[0].name).toBe("Size");
    expect(json.required_fields).toHaveLength(2);
    expect(json.discovery_method).toBe("scrape");
  });

  it("returns 400 MISSING_FIELD when url is missing", async () => {
    const res = await req("POST", "/api/query", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("propagates QUERY_FAILED from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedQuery.mockRejectedValue(
      new BloonError(ErrorCodes.QUERY_FAILED, "Discovery failed"),
    );

    const res = await req("POST", "/api/query", {
      url: "https://shop.example.com/broken",
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("QUERY_FAILED");
  });

  // ---- NL search path ----

  it("returns 400 MISSING_FIELD when both url and query are sent", async () => {
    const res = await req("POST", "/api/query", {
      url: "https://shop.example.com/shoes",
      query: "shoes",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
    expect(json.error.message).toContain("not both");
  });

  it("returns 400 MISSING_FIELD when query is empty string", async () => {
    const res = await req("POST", "/api/query", { query: "" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns 400 MISSING_FIELD when query is whitespace only", async () => {
    const res = await req("POST", "/api/query", { query: "   " });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns 200 search response for { query } with correct shape", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "towels on amazon under $15",
      products: [
        {
          product: {
            name: "Cotton Towels",
            url: "https://amazon.com/dp/B08EXAMPLE",
            price: "12.99",
            brand: "Basics",
            image_url: "https://amazon.com/img.jpg",
          },
          options: [{ name: "Color", values: ["White", "Gray"] }],
          required_fields: [
            { field: "shipping.name", label: "Full name" },
            { field: "shipping.email", label: "Email address" },
            { field: "selections", label: "Product options (Color)" },
          ],
          discovery_method: "exa_search",
          relevance_score: 0.92,
        },
      ],
      search_metadata: {
        total_found: 1,
        domain_filter: ["amazon.com"],
        price_filter: { max: 15 },
      },
    });

    const res = await req("POST", "/api/query", {
      query: "towels on amazon under $15",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.type).toBe("search");
    expect(json.query).toBe("towels on amazon under $15");
    expect(json.products).toHaveLength(1);
    expect(json.products[0].product.name).toBe("Cotton Towels");
    expect(json.products[0].product.source).toBe("amazon.com");
    expect(json.products[0].product.price).toBe("12.99");
    expect(json.products[0].discovery_method).toBe("exa_search");
    expect(json.products[0].relevance_score).toBe(0.92);
    expect(json.products[0].options).toHaveLength(1);
    expect(json.products[0].required_fields.length).toBeGreaterThan(0);
    expect(json.search_metadata.total_found).toBe(1);
    expect(json.search_metadata.domain_filter).toEqual(["amazon.com"]);
    expect(json.search_metadata.price_filter).toEqual({ max: 15 });
  });

  it("routes { query } to searchQuery, not query", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "socks",
      products: [],
      search_metadata: { total_found: 0 },
    });

    await req("POST", "/api/query", { query: "socks" });

    expect(mockedSearchQuery).toHaveBeenCalledWith({ query: "socks" });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("routes { url } to query, not searchQuery", async () => {
    mockedQuery.mockResolvedValue({
      product: { name: "Shoe", url: "https://example.com/shoe", price: "50.00" },
      options: [],
      required_fields: [],
      discovery_method: "scrape",
    });

    await req("POST", "/api/query", { url: "https://example.com/shoe" });

    expect(mockedQuery).toHaveBeenCalled();
    expect(mockedSearchQuery).not.toHaveBeenCalled();
  });

  it("propagates SEARCH_NO_RESULTS as 404", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedSearchQuery.mockRejectedValue(
      new BloonError(ErrorCodes.SEARCH_NO_RESULTS, "No products found"),
    );

    const res = await req("POST", "/api/query", { query: "nonexistent xyzabc" });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("SEARCH_NO_RESULTS");
  });

  it("propagates SEARCH_UNAVAILABLE as 503", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedSearchQuery.mockRejectedValue(
      new BloonError(ErrorCodes.SEARCH_UNAVAILABLE, "EXA_API_KEY not set"),
    );

    const res = await req("POST", "/api/query", { query: "towels" });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe("SEARCH_UNAVAILABLE");
  });

  it("propagates SEARCH_RATE_LIMITED as 429", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedSearchQuery.mockRejectedValue(
      new BloonError(ErrorCodes.SEARCH_RATE_LIMITED, "Rate limit exceeded"),
    );

    const res = await req("POST", "/api/query", { query: "towels" });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("SEARCH_RATE_LIMITED");
  });

  it("search response products include source hostname", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "sneakers",
      products: [
        {
          product: {
            name: "Air Max",
            url: "https://nike.com/products/air-max",
            price: "110.00",
          },
          options: [],
          required_fields: [],
          discovery_method: "exa_search",
          relevance_score: 0.88,
        },
      ],
      search_metadata: { total_found: 1 },
    });

    const res = await req("POST", "/api/query", { query: "sneakers" });
    const json = await res.json();
    expect(json.products[0].product.source).toBe("nike.com");
  });

  it("search response with invalid product URL still formats without crashing", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "towels",
      products: [
        {
          product: {
            name: "Towel",
            url: "not-a-url",
            price: "5.00",
          },
          options: [],
          required_fields: [],
          discovery_method: "exa_search",
          relevance_score: 0.7,
        },
      ],
      search_metadata: { total_found: 1 },
    });

    const res = await req("POST", "/api/query", { query: "towels" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products[0].product.source).toBe("unknown");
  });
});

// ---- POST /api/buy with selections ----

describe("POST /api/buy (selections)", () => {
  it("passes selections through to orchestrator", async () => {
    const fakeOrder: Order = {
      order_id: "bloon_ord_sel01",
      status: "awaiting_confirmation",
      product: {
        name: "Sneaker",
        url: "https://shop.example.com/sneaker",
        price: "89.99",
        source: "scrape",
      },
      payment: {
        total: "91.79",
        price: "89.99",
        fee: "1.80",
        fee_rate: "2%",
      },
      selections: { Color: "Charcoal", Size: "10" },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    };
    mockedBuy.mockResolvedValue(fakeOrder);

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/sneaker",
      selections: { Color: "Charcoal", Size: "10" },
    });
    expect(res.status).toBe(200);

    // Verify selections were passed to buy()
    expect(mockedBuy).toHaveBeenCalledWith(
      expect.objectContaining({
        selections: { Color: "Charcoal", Size: "10" },
      }),
    );
  });

  it("propagates INVALID_SELECTION from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.INVALID_SELECTION, "Bad selection"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/widget",
      selections: { Color: "" },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_SELECTION");
  });
});

// ---- Error handler ----

describe("error handler", () => {
  it("returns 500 with generic message for unknown errors", async () => {
    mockedBuy.mockRejectedValue(new Error("something unexpected"));

    const res = await req("POST", "/api/buy", {
      url: "https://example.com",
    });
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(json.error.message).toBe("Internal server error");
  });
});
