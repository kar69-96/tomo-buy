import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import type {
  Order,
  OrderStatus,
  BloonConfig,
  OrdersStore,
} from "./types.js";

// ---- Data directory ----

function getDataDir(): string {
  return process.env.BLOON_DATA_DIR || path.join(os.homedir(), ".bloon");
}

function ensureDataDir(): void {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ---- Atomic file I/O ----

function readJsonFile<T>(filename: string, fallback: T): T {
  const filepath = path.join(getDataDir(), filename);
  try {
    const data = fs.readFileSync(filepath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(filename: string, data: T): void {
  ensureDataDir();
  const dir = getDataDir();
  const filepath = path.join(dir, filename);
  const tmpPath = filepath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(tmpPath, filepath);
}

// ---- Write serialization (per-file Promise chains) ----

let ordersQueue: Promise<void> = Promise.resolve();
let configQueue: Promise<void> = Promise.resolve();

function enqueueOrders(fn: () => void): Promise<void> {
  ordersQueue = ordersQueue.then(fn);
  return ordersQueue;
}

function enqueueConfig(fn: () => void): Promise<void> {
  configQueue = configQueue.then(fn);
  return configQueue;
}

// ---- ID generation ----

export function generateId(prefix: string): string {
  const bytes = crypto.randomBytes(6);
  const id = BigInt("0x" + bytes.toString("hex"))
    .toString(36)
    .padStart(6, "0")
    .slice(0, 6);
  return `bloon_${prefix}_${id}`;
}

// ---- Order operations ----

export function createOrder(order: Order): Promise<void> {
  return enqueueOrders(() => {
    const store = readJsonFile<OrdersStore>("orders.json", { orders: [] });
    store.orders.push(order);
    writeJsonFile("orders.json", store);
  });
}

export function getOrder(orderId: string): Order | undefined {
  const store = readJsonFile<OrdersStore>("orders.json", { orders: [] });
  return store.orders.find((o) => o.order_id === orderId);
}

export function getOrders(): Order[] {
  const store = readJsonFile<OrdersStore>("orders.json", { orders: [] });
  return store.orders;
}

export function updateOrder(
  orderId: string,
  updates: Partial<Order>
): Promise<void> {
  return enqueueOrders(() => {
    const store = readJsonFile<OrdersStore>("orders.json", { orders: [] });
    const idx = store.orders.findIndex((o) => o.order_id === orderId);
    if (idx === -1) return;
    store.orders[idx] = { ...store.orders[idx]!, ...updates };
    writeJsonFile("orders.json", store);
  });
}

export function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<void> {
  return updateOrder(orderId, { status });
}

// ---- Config operations ----

export function getConfig(): BloonConfig | undefined {
  return readJsonFile<BloonConfig | undefined>("config.json", undefined);
}

export function saveConfig(config: BloonConfig): Promise<void> {
  return enqueueConfig(() => {
    writeJsonFile("config.json", config);
  });
}
