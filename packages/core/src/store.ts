import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import type {
  Order,
  OrderStatus,
  TomoConfig,
  OrdersStore,
  AgentIdentity,
  AgentIdentitiesStore,
  ConnectedAccount,
  ConnectedAccountsStore,
  SiteAccount,
  SiteAccountsStore,
  Run,
  RunsStore,
} from "./types.js";

// ---- Data directory ----

function getDataDir(): string {
  return process.env.TOMO_DATA_DIR || path.join(os.homedir(), ".tomo");
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
  return `tomo_${prefix}_${id}`;
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

// ---- Generic collection resource (atomic, serialized writes) ----

/**
 * Build CRUD helpers for a JSON collection stored under ~/.tomo.
 * Each resource gets its own serialized write queue, mirroring orders.
 */
function createCollection<T>(
  filename: string,
  field: string,
  idField: keyof T,
) {
  let queue: Promise<void> = Promise.resolve();
  const empty = () => ({ [field]: [] }) as Record<string, T[]>;

  const read = (): T[] => {
    const store = readJsonFile<Record<string, T[]>>(filename, empty());
    return store[field] ?? [];
  };

  const enqueue = (fn: () => void): Promise<void> => {
    queue = queue.then(fn);
    return queue;
  };

  return {
    all: read,
    get: (id: string): T | undefined =>
      read().find((item) => item[idField] === (id as unknown)),
    create: (item: T): Promise<void> =>
      enqueue(() => {
        const items = read();
        items.push(item);
        writeJsonFile(filename, { [field]: items });
      }),
    update: (id: string, updates: Partial<T>): Promise<void> =>
      enqueue(() => {
        const items = read();
        const idx = items.findIndex((item) => item[idField] === (id as unknown));
        if (idx === -1) return;
        items[idx] = { ...items[idx]!, ...updates };
        writeJsonFile(filename, { [field]: items });
      }),
    remove: (id: string): Promise<void> =>
      enqueue(() => {
        const items = read().filter((item) => item[idField] !== (id as unknown));
        writeJsonFile(filename, { [field]: items });
      }),
  };
}

// ---- Agent identities ----

const identities = createCollection<AgentIdentity>(
  "identities.json",
  "identities",
  "identity_id",
);

export function getIdentities(): AgentIdentity[] {
  return identities.all();
}
export function getIdentity(id: string): AgentIdentity | undefined {
  return identities.get(id);
}
export function createIdentity(identity: AgentIdentity): Promise<void> {
  return identities.create(identity);
}
export function updateIdentity(
  id: string,
  updates: Partial<AgentIdentity>,
): Promise<void> {
  return identities.update(id, updates);
}

// ---- Connected accounts ----

const connectedAccounts = createCollection<ConnectedAccount>(
  "connected-accounts.json",
  "accounts",
  "account_id",
);

export function getConnectedAccounts(): ConnectedAccount[] {
  return connectedAccounts.all();
}
export function getConnectedAccount(id: string): ConnectedAccount | undefined {
  return connectedAccounts.get(id);
}
export function createConnectedAccount(
  account: ConnectedAccount,
): Promise<void> {
  return connectedAccounts.create(account);
}
export function updateConnectedAccount(
  id: string,
  updates: Partial<ConnectedAccount>,
): Promise<void> {
  return connectedAccounts.update(id, updates);
}

// ---- Site accounts (an identity's account on a specific domain) ----

const siteAccountsStore = (): SiteAccount[] =>
  readJsonFile<SiteAccountsStore>("site-accounts.json", {
    site_accounts: [],
  }).site_accounts;

let siteAccountsQueue: Promise<void> = Promise.resolve();

export function getSiteAccount(
  identityId: string,
  domain: string,
): SiteAccount | undefined {
  return siteAccountsStore().find(
    (a) => a.identity_id === identityId && a.domain === domain,
  );
}

export function createSiteAccount(account: SiteAccount): Promise<void> {
  siteAccountsQueue = siteAccountsQueue.then(() => {
    const accounts = siteAccountsStore();
    accounts.push(account);
    writeJsonFile("site-accounts.json", { site_accounts: accounts });
  });
  return siteAccountsQueue;
}

// ---- Planner runs ----

const runs = createCollection<Run>("runs.json", "runs", "run_id");

export function getRuns(): Run[] {
  return runs.all();
}
export function getRun(id: string): Run | undefined {
  return runs.get(id);
}
export function createRun(run: Run): Promise<void> {
  return runs.create(run);
}
export function updateRun(id: string, updates: Partial<Run>): Promise<void> {
  return runs.update(id, updates);
}

// ---- Config operations ----

export function getConfig(): TomoConfig | undefined {
  return readJsonFile<TomoConfig | undefined>("config.json", undefined);
}

export function saveConfig(config: TomoConfig): Promise<void> {
  return enqueueConfig(() => {
    writeJsonFile("config.json", config);
  });
}
