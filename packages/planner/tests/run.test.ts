import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---- Mock the heavy primitives (browser, network, vault crypto) ----

const { confirmMock, resolveStrategyMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async (input: { order_id: string; loginPlan?: unknown }) => ({
    order: { order_id: input.order_id, status: "completed" },
    receipt: { product: "Sneakers", total_paid: "102.00", order_number: "A1" },
  })),
  resolveStrategyMock: vi.fn(),
}));

vi.mock("@tomo/orchestrator", () => ({
  query: vi.fn(async () => ({
    product: { name: "Sneakers", url: "https://shop.example/p/1", price: "100.00", source: "x" },
    options: [],
    discovery_method: "test",
  })),
  searchQuery: vi.fn(async () => ({ products: [], search_metadata: { total_found: 0 } })),
  buy: vi.fn(async () => ({
    order_id: "tomo_ord_test1",
    status: "awaiting_confirmation",
    product: { name: "Sneakers", url: "https://shop.example/p/1", price: "100.00", source: "x" },
    payment: { price: "100.00", fee: "2.00", fee_rate: "2%", total: "102.00" },
  })),
  confirm: confirmMock,
}));

vi.mock("@tomo/identity", () => ({
  getOpenRouterKey: () => null, // deterministic fallback plan
  completeJson: vi.fn(),
  resolveStrategy: (...args: unknown[]) => resolveStrategyMock(...args),
  getAgentIdentity: () => ({
    identity_id: "tomo_id_x",
    email: "agent@tomo.local",
    inbox_id: "inbox_1",
  }),
  getOrCreateSiteAccount: async () => ({
    account: {},
    password: "VAULTED-SECRET-PW",
  }),
  putSecret: async () => "vault_ref_1",
  getSecret: () => "USER-SESSION-TOKEN",
}));

import { getRun } from "@tomo/core";
import { buy as buyMock } from "@tomo/orchestrator";
import { startRun, resumeRun } from "../src/run.js";

let dir: string;
const origDataDir = process.env.TOMO_DATA_DIR;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-run-"));
  process.env.TOMO_DATA_DIR = dir;
});

afterAll(() => {
  if (origDataDir === undefined) delete process.env.TOMO_DATA_DIR;
  else process.env.TOMO_DATA_DIR = origDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("startRun + resumeRun (agent identity, full pipeline)", () => {
  it("pauses on create_account, then purchase_confirm, then completes", async () => {
    resolveStrategyMock.mockResolvedValue({
      strategy: "agent",
      email: "agent@tomo.local",
      identity_id: "tomo_id_x",
      domain: "shop.example",
      needs_gate: "create_account",
    });

    // 1. Start → resolves login → pauses on create_account
    const start = await startRun("buy https://shop.example/p/1");
    expect(start.status).toBe("awaiting_approval");
    expect(start.gate?.type).toBe("create_account");

    // 2. Approve account creation → proceeds to purchase quote → pauses on confirm
    const afterAccount = await resumeRun(start.run_id, { approved: true });
    expect(afterAccount.status).toBe("awaiting_approval");
    expect(afterAccount.gate?.type).toBe("purchase_confirm");
    expect(afterAccount.gate?.details.item_price).toBe("100.00");
    expect(afterAccount.gate?.details.quote_total).toBe("102.00");
    expect(afterAccount.gate?.details.estimated_max_charge).toBeDefined();

    // 3. Approve purchase → confirms with an agent login plan → completes
    const done = await resumeRun(start.run_id, { approved: true });
    expect(done.status).toBe("completed");
    expect(done.result?.receipt).toMatchObject({ order_number: "A1" });

    // The login plan handed to checkout carries the vaulted password + register flag.
    const loginPlan = confirmMock.mock.calls.at(-1)?.[0]?.loginPlan as
      | { strategy: string; password?: string; register?: boolean }
      | undefined;
    expect(loginPlan?.strategy).toBe("agent");
    expect(loginPlan?.password).toBe("VAULTED-SECRET-PW");
    expect(loginPlan?.register).toBe(true);
  });

  it("rejecting a gate fails the run", async () => {
    resolveStrategyMock.mockResolvedValue({
      strategy: "agent",
      email: "agent@tomo.local",
      identity_id: "tomo_id_x",
      domain: "shop.example",
      needs_gate: "create_account",
    });
    const start = await startRun("buy https://shop.example/p/9");
    const rejected = await resumeRun(start.run_id, { approved: false });
    expect(rejected.status).toBe("failed");
    expect(rejected.error?.code).toBe("USER_REJECTED");
  });
});

describe("session-token path", () => {
  it("stores the token and builds a connected_session login plan", async () => {
    resolveStrategyMock.mockResolvedValue({
      strategy: "connected_session",
      email: "user@gmail.com",
      domain: "united.com",
      needs_gate: "session_token",
    });
    confirmMock.mockClear();

    const start = await startRun("check into my flight at https://united.com/checkin");
    expect(start.gate?.type).toBe("session_token");

    const afterToken = await resumeRun(start.run_id, { session_token: "abc.def.ghi" });
    expect(afterToken.gate?.type).toBe("purchase_confirm");

    const done = await resumeRun(start.run_id, { approved: true });
    expect(done.status).toBe("completed");

    const loginPlan = confirmMock.mock.calls.at(-1)?.[0]?.loginPlan as
      | { strategy: string; sessionCookies?: Array<{ value: string }> }
      | undefined;
    expect(loginPlan?.strategy).toBe("connected_session");
    expect(loginPlan?.sessionCookies?.[0]?.value).toBe("USER-SESSION-TOKEN");
  });
});

describe("Frontier Go Wild flight booking — the booking logic never silently spends", () => {
  it("a vague NL booking request stops at discovery and never reaches checkout", async () => {
    // "book me the first flight tomorrow on Frontier with the Go Wild pass" with
    // NO url → the planner's fallback is [discover(query)] only. A human must pick
    // the actual flight before any purchase step exists. Nothing is bought.
    confirmMock.mockClear();
    resolveStrategyMock.mockClear();

    const start = await startRun(
      "book me the first flight tomorrow on Frontier using the go-wild pass",
    );

    // It completes by surfacing search results — there is no purchase step, so no
    // gate and, critically, no spend.
    expect(start.status).toBe("completed");
    expect(start.gate).toBeUndefined();
    expect(start.result?.query).toContain("Frontier");
    expect(confirmMock).not.toHaveBeenCalled();
    expect(resolveStrategyMock).not.toHaveBeenCalled();
  });

  it("auto-logs-in via emailed OTP on the connected account — no session-token gate, only purchase confirm", async () => {
    // This mirrors what the REAL resolver returns for a "my go-wild pass" flight
    // task when the user's email is connected (verified live against Composio +
    // OpenRouter): { strategy: "connected_otp", email: <user>, domain }. A
    // connected_otp login needs NO human gate — the code is read from the user's
    // inbox automatically. The only human gate left is the purchase confirmation.
    resolveStrategyMock.mockResolvedValue({
      strategy: "connected_otp",
      email: "kreddy.2027@gmail.com",
      domain: "flyfrontier.com",
      // no needs_gate: OTP login is fully automated, nothing for the user to provide
    });
    confirmMock.mockClear();
    confirmMock.mockResolvedValueOnce({
      order: { order_id: "tomo_ord_test1", status: "awaiting_confirmation" },
      parked: { at: "payment", observed_total: "102.00", session_id: "sess_frontier" },
    });

    process.env.DRY_RUN_NO_SPEND = "1";
    try {
      // Start → discover → OTP login (automatic, no gate) → first stop is purchase.
      const start = await startRun(
        "book the first flight tomorrow at https://www.flyfrontier.com/book/flight using my go-wild pass",
      );
      // Crucially: NO session_token gate. Login resolved straight to OTP, so the
      // first (and only) human gate is the purchase confirmation.
      expect(start.gate?.type).toBe("purchase_confirm");
      expect(start.gate?.details.quote_total).toBe("102.00");
      expect(start.gate?.details.estimated_max_charge).toBeDefined();
      expect(confirmMock).not.toHaveBeenCalled();

      // Approve the purchase → the real browser runs to the payment page and STOPS.
      const done = await resumeRun(start.run_id, { approved: true });
      expect(done.status).toBe("completed");
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock.mock.calls.at(-1)?.[0]?.stopBeforePlaceOrder).toBe(true);
      expect(done.result?.parked).toEqual({
        at: "payment",
        observed_total: "102.00",
        session_id: "sess_frontier",
      });
      expect(done.result?.receipt).toBeUndefined();

      // The login plan handed to checkout is OTP-based: type the user's email, read
      // the code from their connected inbox. No password, no session token, no
      // secret in the persisted run.
      const loginPlan = confirmMock.mock.calls.at(-1)?.[0]?.loginPlan as
        | { strategy: string; email?: string; password?: string; sessionCookies?: unknown }
        | undefined;
      expect(loginPlan?.strategy).toBe("connected_otp");
      expect(loginPlan?.email).toBe("kreddy.2027@gmail.com");
      expect(loginPlan?.password).toBeUndefined();
      expect(loginPlan?.sessionCookies).toBeUndefined();
    } finally {
      delete process.env.DRY_RUN_NO_SPEND;
    }
  });
});

describe("lifecycle invariant — a run never stays 'running' after a step throws", () => {
  it("persists 'failed' (not 'running') when a step throws mid-execution", async () => {
    // Simulate a process-killing failure mid-execution: the purchase quote step
    // throws (browser crash / network death / escaped error). The run MUST land
    // in a terminal "failed" status, never be stranded in "running".
    resolveStrategyMock.mockResolvedValue({
      strategy: "guest",
      email: "",
      domain: "shop.example",
    });
    vi.mocked(buyMock).mockRejectedValueOnce(new Error("browser crashed mid-checkout"));

    const start = await startRun("buy https://shop.example/p/crash as a guest");

    expect(start.status).toBe("failed");
    expect(start.error?.message).toContain("browser crashed");

    // The persisted run (what ~/.tomo/runs.json would hold) is terminal — not "running".
    const persisted = getRun(start.run_id);
    expect(persisted?.status).toBe("failed");
    expect(persisted?.status).not.toBe("running");
  });
});

describe("no-spend oversight mode (DRY_RUN_NO_SPEND)", () => {
  it("calls confirm with stopBeforePlaceOrder and surfaces the parked checkpoint", async () => {
    resolveStrategyMock.mockResolvedValue({
      strategy: "guest",
      email: "",
      domain: "shop.example",
    });
    confirmMock.mockClear();
    confirmMock.mockResolvedValueOnce({
      order: { order_id: "tomo_ord_test1", status: "awaiting_confirmation" },
      parked: { at: "payment", observed_total: "102.00", session_id: "sess_park" },
    });

    process.env.DRY_RUN_NO_SPEND = "1";
    try {
      const start = await startRun("buy https://shop.example/p/1 as a guest");
      // Guest → no login gate → first stop is the purchase confirmation.
      expect(start.gate?.type).toBe("purchase_confirm");

      const done = await resumeRun(start.run_id, { approved: true });
      expect(done.status).toBe("completed");
      // The browser ran in stop-before-place-order mode...
      expect(confirmMock.mock.calls.at(-1)?.[0]?.stopBeforePlaceOrder).toBe(true);
      // ...and the run surfaces the parked checkpoint instead of a receipt.
      expect(done.result?.parked).toEqual({
        at: "payment",
        observed_total: "102.00",
        session_id: "sess_park",
      });
      expect(done.result?.receipt).toBeUndefined();
    } finally {
      delete process.env.DRY_RUN_NO_SPEND;
    }
  });
});
