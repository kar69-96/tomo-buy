/**
 * LIVE classify → plan → park-at-gate wiring test.
 *
 * run.test.ts mocks BOTH @tomo/orchestrator and @tomo/identity, so it proves the
 * gate state machine but not that a real natural-language task flows through the
 * real LLM planner + real classifier to the correct login gate. THIS file mocks
 * ONLY @tomo/orchestrator — discovery/quote/checkout are stubbed so there is no
 * browser, no Exa, and no spend — while the planner (`plan`/`buildBrief`) and the
 * identity resolver (`resolveStrategy`) run for real against OpenRouter/Composio.
 *
 * It drives `startRun()` (the same path /api/run uses) and asserts the run parks
 * at the login gate the classifier's routing implies:
 *   - generic shopping → `agent` identity → `create_account` gate
 *   - the user's records → `connected_*` → `session_token` gate, OR (when the
 *     user's email is connected) OTP auto-login with no login gate, landing on
 *     the `purchase_confirm` gate instead. Both are accepted.
 *
 * Self-skips unless LIVE_LLM=1. Requires keys in .env and a built workspace
 * (`pnpm build`, so the real @tomo/identity dist resolves).
 *
 *   LIVE_LLM=1 pnpm vitest run packages/planner/tests/run.live.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getRun } from "@tomo/core";
import type { GateType, LoginStrategy, PlanStep } from "@tomo/core";

const LIVE = process.env.LIVE_LLM === "1";

// Stub the heavy I/O (browser discovery, quote, checkout) so the run reaches the
// login gate without launching Chrome, hitting Exa, or spending. The planner and
// the identity resolver are NOT mocked — they make real LLM/Composio calls.
vi.mock("@tomo/orchestrator", () => ({
  query: vi.fn(async () => ({
    product: { name: "Test Item", url: "https://shop.example/products/mug", price: "20.00", source: "test" },
    options: [],
    discovery_method: "test",
  })),
  searchQuery: vi.fn(async () => ({ products: [], search_metadata: { total_found: 0 } })),
  buy: vi.fn(async () => ({
    order_id: "tomo_ord_live",
    status: "awaiting_confirmation",
    product: { name: "Test Item", url: "https://shop.example/products/mug", price: "20.00", source: "test" },
    payment: { price: "20.00", fee: "0.40", fee_rate: "2%", total: "20.40" },
  })),
  // Never reached: every case stops at a gate before purchase is confirmed.
  confirm: vi.fn(async () => {
    throw new Error("confirm() must not run — the test parks before checkout");
  }),
}));

import { startRun } from "../src/run.js";

type Category = "agent" | "connected";

function categoryOf(strategy: LoginStrategy | undefined): Category | undefined {
  if (strategy === "agent") return "agent";
  if (strategy === "connected_otp" || strategy === "connected_session") return "connected";
  return undefined;
}

interface Case {
  name: string;
  task: string;
  want: Category;
  /** Gate types acceptable for this routing (OTP auto-login skips the login gate). */
  gates: GateType[];
  /** Capabilities the plan must include. A product flow discovers first; a
   *  form_flow booking on a known URL has no product to discover, so the planner
   *  legitimately composes just login + purchase. */
  mustHaveCaps: string[];
}

const CASES: Case[] = [
  {
    name: "generic URL purchase → agent identity, create_account gate",
    task: "buy this https://shop.example/products/mug",
    want: "agent",
    gates: ["create_account"],
    mustHaveCaps: ["discover", "login", "purchase"],
  },
  {
    name: "user's flight booking → connected account, session_token or purchase gate",
    task: "using my account, book a one-way flight on https://www.united.com/booking for one adult",
    want: "connected",
    gates: ["session_token", "purchase_confirm"],
    mustHaveCaps: ["login", "purchase"],
  },
];

describe.skipIf(!LIVE)("LIVE classify → plan → gate (real planner + resolver)", () => {
  let dir: string;
  const origDataDir = process.env.TOMO_DATA_DIR;

  beforeAll(() => {
    // Fresh identity/vault/run state: a brand-new agent has no site account yet,
    // so the agent case deterministically parks on `create_account`.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-run-live-"));
    process.env.TOMO_DATA_DIR = dir;
  });

  afterAll(() => {
    if (origDataDir === undefined) delete process.env.TOMO_DATA_DIR;
    else process.env.TOMO_DATA_DIR = origDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(CASES)(
    "$name",
    async ({ task, want, gates, mustHaveCaps }) => {
      const outcome = await startRun(task);

      // The run paused for a human at the implied gate (never completed/spent).
      expect(outcome.status, JSON.stringify(outcome)).toBe("awaiting_approval");
      expect(gates).toContain(outcome.gate?.type);

      // The classifier routed to the expected account category, persisted on the run.
      const run = getRun(outcome.run_id);
      const strategy = (run?.context as { login?: { strategy?: LoginStrategy } } | undefined)
        ?.login?.strategy;
      expect(categoryOf(strategy), `strategy=${strategy}`).toBe(want);

      // The planner grounded a concrete brief and composed the full step chain.
      expect(outcome.brief?.target.domain).toBeTruthy();
      const caps = (run?.plan.steps ?? []).map((s: PlanStep) => s.capability);
      for (const cap of mustHaveCaps) expect(caps, `caps=${caps.join(",")}`).toContain(cap);
    },
    120_000,
  );
});
