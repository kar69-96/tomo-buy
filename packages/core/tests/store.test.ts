import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createOrder,
  getOrder,
  getOrders,
  updateOrder,
  updateOrderStatus,
  generateId,
} from "../src/store.js";
import type { Order } from "../src/types.js";

let tmpDir: string;

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    order_id: generateId("ord"),
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://example.com/product",
      price: "17.99",
      source: "example.com",
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
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.BLOON_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateId", () => {
  it("generates IDs with correct prefix format", () => {
    const id = generateId("w");
    expect(id).toMatch(/^bloon_w_[a-z0-9]{6}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("w")));
    expect(ids.size).toBe(100);
  });
});

describe("order CRUD", () => {
  it("creates and reads an order", async () => {
    const order = makeOrder();
    await createOrder(order);

    const retrieved = getOrder(order.order_id);
    expect(retrieved).toEqual(order);
  });

  it("updates order status", async () => {
    const order = makeOrder();
    await createOrder(order);
    await updateOrderStatus(order.order_id, "processing");

    const retrieved = getOrder(order.order_id);
    expect(retrieved?.status).toBe("processing");
  });

  it("updates order with partial data", async () => {
    const order = makeOrder();
    await createOrder(order);
    await updateOrder(order.order_id, {
      confirmed_at: new Date().toISOString(),
    });

    const retrieved = getOrder(order.order_id);
    expect(retrieved?.confirmed_at).toBeDefined();
  });

  it("lists all orders", async () => {
    const o1 = makeOrder();
    const o2 = makeOrder();
    await createOrder(o1);
    await createOrder(o2);

    const all = getOrders();
    expect(all).toHaveLength(2);
  });
});

describe("disk persistence", () => {
  it("persists orders to disk and reloads", async () => {
    const order = makeOrder();
    await createOrder(order);
    await updateOrderStatus(order.order_id, "completed");

    const filePath = path.join(tmpDir, "orders.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const reloaded = getOrder(order.order_id);
    expect(reloaded?.status).toBe("completed");
  });
});
