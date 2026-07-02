import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Order, ShippingInfo } from "@tomo/core";
import type { AgentRun } from "../src/browserbase-agents/client.js";

// Mock the network-touching pieces; the engine's job is task-build → start →
// poll → validate → map, so we control the terminal run and assert the mapping.
const startRun = vi.fn(async () => ({ runId: "run_1", status: "PENDING" }) as AgentRun);
const pollRun = vi.fn();

vi.mock("../src/browserbase-agents/client.js", () => ({
  startRun: (...args: unknown[]) => startRun(...(args as [])),
}));
vi.mock("../src/browserbase-agents/poll.js", () => ({
  pollRun: (...args: unknown[]) => pollRun(...(args as [])),
}));

const { runCheckoutViaBrowserbaseAgents } = await import(
  "../src/browserbase-agents/engine.js"
);

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

const ORDER: Order = {
  order_id: "ord_1",
  status: "awaiting_confirmation",
  product: { name: "Widget", url: "https://shop.example.com/widget", price: "18.00" } as Order["product"],
  payment: { price: "18.00" } as Order["payment"],
  shipping: SHIPPING,
  created_at: "2026-07-01T00:00:00Z",
  expires_at: "2026-07-02T00:00:00Z",
};

const INPUT = { order: ORDER, shipping: SHIPPING };

function terminal(status: AgentRun["status"], result?: unknown): AgentRun {
  return { runId: "run_1", status, sessionId: "sess_9", result };
}

beforeEach(() => {
  startRun.mockClear();
  pollRun.mockClear();
});

describe("runCheckoutViaBrowserbaseAgents", () => {
  it("maps a COMPLETED reached_payment run to a parked-at-payment success", async () => {
    pollRun.mockResolvedValueOnce(
      terminal("COMPLETED", {
        status: "reached_payment",
        observed_total: "$18.42",
        order_summary: "1x Widget in cart, on payment page",
      }),
    );
    const res = await runCheckoutViaBrowserbaseAgents(INPUT);
    expect(res.success).toBe(true);
    expect(res.parkedAtPayment).toBe(true);
    expect(res.finalTotal).toBe("$18.42");
    expect(res.sessionId).toBe("sess_9");
    expect(res.replayUrl).toBe("https://www.browserbase.com/sessions/sess_9");
  });

  it("returns failure for a non-COMPLETED terminal state", async () => {
    pollRun.mockResolvedValueOnce({ ...terminal("FAILED"), cause: { code: "x", message: "site down" } });
    const res = await runCheckoutViaBrowserbaseAgents(INPUT);
    expect(res.success).toBe(false);
    expect(res.errorMessage).toContain("site down");
  });

  it("returns failure when the run completes but did not reach payment", async () => {
    pollRun.mockResolvedValueOnce(
      terminal("COMPLETED", {
        status: "blocked",
        observed_total: "",
        order_summary: "hit a login wall",
        blocked_reason: "account required",
      }),
    );
    const res = await runCheckoutViaBrowserbaseAgents(INPUT);
    expect(res.success).toBe(false);
    expect(res.errorMessage).toContain("account required");
  });

  it("returns failure when the result is malformed", async () => {
    pollRun.mockResolvedValueOnce(terminal("COMPLETED", { nonsense: true }));
    const res = await runCheckoutViaBrowserbaseAgents(INPUT);
    expect(res.success).toBe(false);
    expect(res.errorMessage).toContain("malformed");
  });

  it("never forwards a card into the run request", async () => {
    pollRun.mockResolvedValueOnce(
      terminal("COMPLETED", { status: "reached_payment", observed_total: "$1", order_summary: "ok" }),
    );
    await runCheckoutViaBrowserbaseAgents({
      ...INPUT,
      card: { number: "4111111111111111", expiry: "12/30", cvv: "737", cardholder_name: "Ada" },
    });
    const body = startRun.mock.calls[0]![0] as { task: string; variables: Record<string, unknown> };
    const blob = JSON.stringify(body);
    expect(blob).not.toContain("4111111111111111");
    expect(blob).not.toContain("737");
  });
});
