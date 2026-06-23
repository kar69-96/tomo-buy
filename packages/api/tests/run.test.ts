import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tomo/planner", () => ({
  startRun: vi.fn(),
  resumeRun: vi.fn(),
}));

import { startRun, resumeRun } from "@tomo/planner";
import { createApp } from "../src/server.js";

const mockedStart = vi.mocked(startRun);
const mockedResume = vi.mocked(resumeRun);

const app = createApp();

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/run", () => {
  it("400s when task is missing", async () => {
    const res = await post("/api/run", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns the gate envelope when the run pauses", async () => {
    mockedStart.mockResolvedValue({
      run_id: "tomo_run_1",
      status: "awaiting_approval",
      gate: { type: "purchase_confirm", details: { quote_total: "102.00" } },
    });
    const res = await post("/api/run", { task: "buy https://x.com/p" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("awaiting_approval");
    expect(json.gate.type).toBe("purchase_confirm");
    expect(mockedStart).toHaveBeenCalledWith("buy https://x.com/p");
  });
});

describe("POST /api/run/:id/approve", () => {
  it("resumes and returns completion", async () => {
    mockedResume.mockResolvedValue({
      run_id: "tomo_run_1",
      status: "completed",
      result: { receipt: { order_number: "A1" } },
    });
    const res = await post("/api/run/tomo_run_1/approve", { approved: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(mockedResume).toHaveBeenCalledWith("tomo_run_1", {
      approved: true,
      session_token: undefined,
      cookie_name: undefined,
    });
  });

  it("maps an unknown run to 404", async () => {
    mockedResume.mockResolvedValue({
      run_id: "missing",
      status: "failed",
      error: { code: "RUN_NOT_FOUND", message: "No run missing" },
    });
    const res = await post("/api/run/missing/approve", { approved: true });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("RUN_NOT_FOUND");
  });

  it("passes a session token through to resume", async () => {
    mockedResume.mockResolvedValue({
      run_id: "tomo_run_2",
      status: "awaiting_approval",
      gate: { type: "purchase_confirm", details: {} },
    });
    await post("/api/run/tomo_run_2/approve", { session_token: "tok.123" });
    expect(mockedResume).toHaveBeenCalledWith("tomo_run_2", {
      approved: undefined,
      session_token: "tok.123",
      cookie_name: undefined,
    });
  });
});
