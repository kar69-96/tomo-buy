import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock the LLM so the resolver is deterministic and offline.
vi.mock("../src/llm.js", () => ({
  getOpenRouterKey: () => "test-key",
  completeJson: vi.fn(),
}));

import { completeJson } from "../src/llm.js";
import { resolveStrategy, normalizeDomain, wantsGuest } from "../src/resolver.js";
import {
  setComposioClient,
  StubComposioClient,
  type ComposioClient,
} from "../src/composio.js";

let dir: string;
const origDataDir = process.env.TOMO_DATA_DIR;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-resolver-"));
  process.env.TOMO_DATA_DIR = dir;
});

afterAll(() => {
  if (origDataDir === undefined) delete process.env.TOMO_DATA_DIR;
  else process.env.TOMO_DATA_DIR = origDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  setComposioClient(new StubComposioClient());
  vi.mocked(completeJson).mockReset();
});

describe("normalizeDomain", () => {
  it("strips scheme and www", () => {
    expect(normalizeDomain("https://www.Amazon.com/dp/123")).toBe("amazon.com");
    expect(normalizeDomain("united.com")).toBe("united.com");
  });
});

describe("wantsGuest", () => {
  it("detects explicit guest-checkout phrasing", () => {
    expect(wantsGuest("buy this as a guest")).toBe(true);
    expect(wantsGuest("check out as guest please")).toBe(true);
    expect(wantsGuest("use guest checkout")).toBe(true);
    expect(wantsGuest("buy it without an account")).toBe(true);
    expect(wantsGuest("purchase this without creating an account")).toBe(true);
    expect(wantsGuest("buy it without making an account")).toBe(true);
    expect(wantsGuest("don't sign in, just buy it")).toBe(true);
  });
  it("does not fire on normal purchase tasks", () => {
    expect(wantsGuest("buy these sneakers")).toBe(false);
    expect(wantsGuest("create an account and buy this")).toBe(false);
  });
});

describe("resolveStrategy", () => {
  it("short-circuits to guest when the task asks for guest checkout", async () => {
    const r = await resolveStrategy({
      task: "buy this and check out as a guest",
      domain: "https://random-shop.example/p/1",
    });
    expect(r.strategy).toBe("guest");
    expect(r.needs_gate).toBeUndefined();
    // The LLM is never consulted for an explicit guest request.
    expect(vi.mocked(completeJson)).not.toHaveBeenCalled();
  });

  it("routes to an agent identity for a generic shop", async () => {
    vi.mocked(completeJson).mockResolvedValue({ needs_user_account: false });
    const r = await resolveStrategy({
      task: "buy sneakers",
      domain: "https://random-shop.example/p/1",
    });
    expect(r.strategy).toBe("agent");
    expect(r.identity_id).toBeTruthy();
    // first time on this site → must approve account creation
    expect(r.needs_gate).toBe("create_account");
  });

  it("routes to the user's account (session token) when needed and email not connected", async () => {
    vi.mocked(completeJson).mockResolvedValue({
      needs_user_account: true,
      preferred_method: "session",
    });
    const r = await resolveStrategy({
      task: "check me into my flight",
      domain: "united.com",
    });
    expect(r.strategy).toBe("connected_session");
    expect(r.needs_gate).toBe("session_token");
  });

  it("uses OTP login when the user's email is connected", async () => {
    const fake: ComposioClient = {
      isConnected: async () => true,
      listConnections: async () => [],
      searchEmail: async () => [
        {
          id: "m1",
          from: "no-reply@united.com",
          subject: "Your account",
          snippet: "",
          received_at: "2026-01-01T00:00:00Z",
        },
      ],
      getMessage: async () => null,
    };
    setComposioClient(fake);
    vi.mocked(completeJson).mockResolvedValue({
      needs_user_account: true,
      preferred_method: "otp",
    });
    const r = await resolveStrategy({
      task: "show my orders",
      domain: "united.com",
    });
    expect(r.strategy).toBe("connected_otp");
    expect(r.needs_gate).toBeUndefined();
  });
});
