import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Order, ShippingInfo, CardInfo } from "@tomo/core";
import {
  buildAgentTask,
  assertNoCdpSecrets,
} from "../src/browserbase-agents/task-builder.js";
import { pollRun, isTerminal } from "../src/browserbase-agents/poll.js";
import { startRun, getRun } from "../src/browserbase-agents/client.js";
import type { AgentRun } from "../src/browserbase-agents/client.js";

// ---- Fixtures ----

const SHIPPING: ShippingInfo = {
  name: "Ada Lovelace",
  street: "1 Analytical Way",
  city: "London",
  state: "LN",
  zip: "EC1A",
  country: "GB",
  email: "ada@example.com",
  phone: "5551234567",
};

// A card whose values must NEVER appear in a Browserbase task/variables payload.
const CARD: CardInfo = {
  number: "4111111111111111",
  expiry: "12/30",
  cvv: "737",
  cardholder_name: "Ada Lovelace",
};

function makeOrder(): Order {
  return {
    order_id: "ord_1",
    status: "awaiting_confirmation",
    product: { name: "Widget", url: "https://shop.example.com/widget", price: "18.00" } as Order["product"],
    payment: { price: "18.00" } as Order["payment"],
    shipping: SHIPPING,
    selections: { Size: "M", Color: "Blue" },
    created_at: "2026-07-01T00:00:00Z",
    expires_at: "2026-07-02T00:00:00Z",
  };
}

// ---- task-builder ----

describe("buildAgentTask", () => {
  it("passes non-secret shipping/contact fields as %variables%", () => {
    const { variables } = buildAgentTask({
      order: makeOrder(),
      shipping: SHIPPING,
      card: CARD,
    });
    expect(variables.x_shipping_name?.value).toBe("Ada Lovelace");
    expect(variables.x_shipping_zip?.value).toBe("EC1A");
    expect(variables.x_shipping_email?.value).toBe("ada@example.com");
  });

  it("NEVER puts card secrets in variables or the task text (Prime Directive)", () => {
    const { task, variables } = buildAgentTask({
      order: makeOrder(),
      shipping: SHIPPING,
      card: CARD,
    });
    for (const secret of ["x_card_number", "x_card_expiry", "x_card_cvv", "x_cardholder_name"]) {
      expect(variables[secret]).toBeUndefined();
    }
    const blob = JSON.stringify(variables) + task;
    expect(blob).not.toContain(CARD.number);
    expect(blob).not.toContain(CARD.cvv);
  });

  it("includes the login email (LLM-safe) but never a password", () => {
    const { task, variables } = buildAgentTask({
      order: makeOrder(),
      shipping: SHIPPING,
      card: CARD,
      loginPlan: { strategy: "agent", email: "agent@inbox.dev", password: "hunter2", domain: "shop.example.com" },
    });
    expect(variables.x_login_email?.value).toBe("agent@inbox.dev");
    expect(variables.x_login_password).toBeUndefined();
    expect(JSON.stringify(variables) + task).not.toContain("hunter2");
  });

  it("instructs the agent to stop before payment", () => {
    const { task } = buildAgentTask({ order: makeOrder(), shipping: SHIPPING, card: CARD });
    expect(task).toContain(makeOrder().product.url);
    expect(task.toLowerCase()).toContain("do not enter");
    expect(task.toLowerCase()).toContain("payment");
  });
});

describe("assertNoCdpSecrets", () => {
  it("throws if a CDP-only secret leaks into the variable map", () => {
    expect(() =>
      assertNoCdpSecrets({ x_card_number: { value: "4111" } }),
    ).toThrow(/Prime Directive/);
    expect(() =>
      assertNoCdpSecrets({ x_login_password: { value: "x" } }),
    ).toThrow(/Prime Directive/);
  });

  it("passes for a non-secret map", () => {
    expect(() =>
      assertNoCdpSecrets({ x_shipping_zip: { value: "EC1A" } }),
    ).not.toThrow();
  });
});

// ---- poll ----

describe("pollRun", () => {
  const terminal = (status: AgentRun["status"]): AgentRun => ({ runId: "r1", status });

  it("returns as soon as the run hits a terminal state", async () => {
    const seq: AgentRun[] = [terminal("PENDING"), terminal("RUNNING"), terminal("COMPLETED")];
    let i = 0;
    const run = await pollRun("r1", {
      timeoutMs: 10_000,
      intervalMs: 0,
      now: () => 0,
      sleep: async () => {},
      fetchRun: async () => seq[i++]!,
    });
    expect(run.status).toBe("COMPLETED");
    expect(i).toBe(3);
  });

  it("throws when it never reaches terminal before the timeout", async () => {
    let clock = 0;
    await expect(
      pollRun("r1", {
        timeoutMs: 5,
        intervalMs: 0,
        now: () => (clock += 10), // advances past the timeout on the first check
        sleep: async () => {},
        fetchRun: async () => terminal("RUNNING"),
      }),
    ).rejects.toThrow(/did not finish/);
  });

  it("classifies terminal states", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("RUNNING")).toBe(false);
  });
});

// ---- client (fetch stubbed) ----

describe("client", () => {
  const savedKey = process.env.BROWSERBASE_API_KEY;
  beforeEach(() => {
    process.env.BROWSERBASE_API_KEY = "bb_test";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = savedKey;
    vi.unstubAllGlobals();
  });

  it("startRun POSTs to /agents/runs with the API-key header and body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ runId: "run_1", status: "PENDING" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const run = await startRun({ task: "do it" });
    expect(run.runId).toBe("run_1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.browserbase.com/v1/agents/runs");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-BB-API-Key"]).toBe("bb_test");
    expect(JSON.parse(init.body as string).task).toBe("do it");
  });

  it("startRun throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "nope" })),
    );
    await expect(startRun({ task: "x" })).rejects.toThrow(/401/);
  });

  it("getRun GETs the run by id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ runId: "run_1", status: "COMPLETED" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const run = await getRun("run_1");
    expect(run.status).toBe("COMPLETED");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.browserbase.com/v1/agents/runs/run_1");
  });
});
