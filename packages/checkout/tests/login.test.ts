import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DOM-touching helpers so we can drive executeLogin with a fake page.
vi.mock("../src/scripted-actions.js", () => ({
  scriptedClickButton: vi.fn(async () => true),
  scriptedFillVerificationCode: vi.fn(async () => true),
}));
vi.mock("../src/agentmail.js", () => ({
  pollForVerificationCode: vi.fn(async () => null),
}));
vi.mock("@tomo/identity", () => ({
  getComposioClient: () => ({
    isConnected: async () => false,
    searchEmail: async () => [],
    getMessage: async () => null,
  }),
  extractCode: () => null,
}));

import { executeLogin, seedSessionCookies } from "../src/login.js";
import type { LoginPlan } from "../src/login.js";

interface FillRecord {
  selector: string;
  value: string;
}

function fakePage(present: (selector: string) => boolean) {
  const fills: FillRecord[] = [];
  const page = {
    fills,
    locator(selector: string) {
      return {
        first() {
          return {
            async count() {
              return present(selector) ? 1 : 0;
            },
            async fill(value: string) {
              fills.push({ selector, value });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };
  return page as unknown as import("playwright").Page & { fills: FillRecord[] };
}

const ctx = {} as unknown as import("playwright").BrowserContext;

beforeEach(() => vi.clearAllMocks());

describe("executeLogin", () => {
  it("does not handle the gate for a missing plan (guest fallback)", async () => {
    const page = fakePage(() => true);
    const res = await executeLogin(page, ctx, undefined);
    expect(res.handled).toBe(false);
  });

  it("does not handle an explicit guest strategy", async () => {
    const page = fakePage(() => true);
    const plan: LoginPlan = { strategy: "guest", email: "", domain: "x.com" };
    const res = await executeLogin(page, ctx, plan);
    expect(res.handled).toBe(false);
  });

  it("fills email + password directly for an agent identity", async () => {
    const page = fakePage((sel) => sel.includes("email") || sel.includes("pass"));
    const plan: LoginPlan = {
      strategy: "agent",
      email: "agent@tomo.local",
      password: "S3cret-Direct-Fill!",
      domain: "shop.example",
      register: true,
    };
    const res = await executeLogin(page, ctx, plan);
    expect(res.handled).toBe(true);
    const values = page.fills.map((f) => f.value);
    expect(values).toContain("agent@tomo.local");
    expect(values).toContain("S3cret-Direct-Fill!");
  });

  it("handles a session-cookie login without typing a password", async () => {
    const page = fakePage(() => false);
    const plan: LoginPlan = {
      strategy: "connected_session",
      email: "user@gmail.com",
      domain: "united.com",
    };
    const res = await executeLogin(page, ctx, plan);
    expect(res.handled).toBe(true);
    expect(page.fills).toHaveLength(0);
  });
});

describe("seedSessionCookies", () => {
  it("normalizes domain cookies and calls addCookies", async () => {
    const added: unknown[] = [];
    const context = {
      addCookies: async (cookies: unknown[]) => {
        added.push(...cookies);
      },
    } as unknown as import("playwright").BrowserContext;

    await seedSessionCookies(context, [
      { name: "session", value: "tok", domain: "united.com" },
    ]);
    expect(added).toEqual([
      { name: "session", value: "tok", domain: ".united.com", path: "/" },
    ]);
  });

  it("no-ops on empty input", async () => {
    let called = false;
    const context = {
      addCookies: async () => {
        called = true;
      },
    } as unknown as import("playwright").BrowserContext;
    await seedSessionCookies(context, []);
    expect(called).toBe(false);
  });
});
