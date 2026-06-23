import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Order } from "@bloon/core";

// ---- Mock external packages ----

vi.mock("@bloon/checkout", () => ({
  runCheckout: vi.fn(),
}));

import { runCheckout } from "@bloon/checkout";
import { confirm } from "../src/confirm.js";

const mockedRunCheckout = vi.mocked(runCheckout);

// ---- Test helpers ----

let tmpDir: string;

function writeStore(filename: string, data: unknown): void {
  fs.writeFileSync(path.join(tmpDir, filename), JSON.stringify(data, null, 2));
}

function setupConfig(): void {
  writeStore("config.json", {
    default_order_expiry_seconds: 300,
    port: 3000,
  });
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    order_id: "bloon_ord_test01",
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://example.com/product",
      price: "10.00",
      source: "scrape",
    },
    payment: {
      total: "10.20",
      price: "10.00",
      fee: "0.20",
      fee_rate: "2%",
    },
    shipping: {
      name: "Test User",
      street: "123 Main St",
      city: "Denver",
      state: "CO",
      zip: "80202",
      country: "US",
      email: "test@test.com",
      phone: "+10001112222",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };
}

function seedOrder(order: Order): void {
  writeStore("orders.json", { orders: [order] });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-confirm-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
  setupConfig();
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BLOON_DATA_DIR;
});

// ---- Tests ----

describe("confirm", () => {
  it("confirm browser order checks out and returns receipt", async () => {
    const order = makeOrder();
    seedOrder(order);

    mockedRunCheckout.mockResolvedValue({
      success: true,
      orderNumber: "ORD-12345",
      sessionId: "sess_abc",
      replayUrl: "https://browserbase.com/replay/abc",
    });

    const result = await confirm({ order_id: "bloon_ord_test01" });

    expect(result.receipt.price).toBe("10.00");
    expect(result.receipt.fee).toBe("0.20");
    expect(result.receipt.order_number).toBe("ORD-12345");
    expect(result.receipt.browserbase_session_id).toBe("sess_abc");
  });

  it("confirm expired order throws ORDER_EXPIRED", async () => {
    const order = makeOrder({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    seedOrder(order);

    await expect(
      confirm({ order_id: "bloon_ord_test01" }),
    ).rejects.toThrow(expect.objectContaining({ code: "ORDER_EXPIRED" }));

    // Verify status updated to expired in store
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "orders.json"), "utf-8"),
    );
    expect(stored.orders[0].status).toBe("expired");
  });

  it("confirm already completed order returns existing receipt", async () => {
    const existingReceipt = {
      product: "Test Product",
      merchant: "example.com",
      price: "10.00",
      fee: "0.20",
      total_paid: "10.20",
      timestamp: "2026-01-01T00:00:00.000Z",
      order_number: "ORD-99999",
    };

    const order = makeOrder({
      status: "completed",
      receipt: existingReceipt,
    });
    seedOrder(order);

    const result = await confirm({ order_id: "bloon_ord_test01" });

    expect(result.receipt).toEqual(existingReceipt);
    // No checkout should have been called
    expect(mockedRunCheckout).not.toHaveBeenCalled();
  });

  it("confirm where checkout fails sets order to failed", async () => {
    const order = makeOrder();
    seedOrder(order);

    mockedRunCheckout.mockRejectedValue(new Error("Browser session crashed"));

    await expect(
      confirm({ order_id: "bloon_ord_test01" }),
    ).rejects.toThrow(expect.objectContaining({ code: "CHECKOUT_FAILED" }));

    // Verify order in store has failed status
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "orders.json"), "utf-8"),
    );
    const failedOrder = stored.orders[0];
    expect(failedOrder.status).toBe("failed");
    expect(failedOrder.error.code).toBe("CHECKOUT_FAILED");
  });

  it("confirm browser order passes selections to runCheckout", async () => {
    const order = makeOrder({
      selections: { Color: "Charcoal", Size: "10" },
    });
    seedOrder(order);

    mockedRunCheckout.mockResolvedValue({
      success: true,
      orderNumber: "ORD-SEL-001",
      sessionId: "sess_sel",
      replayUrl: "https://browserbase.com/replay/sel",
    });

    const result = await confirm({ order_id: "bloon_ord_test01" });

    expect(result.receipt.order_number).toBe("ORD-SEL-001");
    // Verify selections were forwarded to runCheckout
    expect(mockedRunCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        selections: { Color: "Charcoal", Size: "10" },
      }),
    );
  });
});
