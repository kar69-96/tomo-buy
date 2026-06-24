/**
 * LIVE login-classifier eval — exercises the REAL resolver against OpenRouter +
 * Composio, with nothing mocked.
 *
 * resolver.test.ts mocks `completeJson`, so it only proves the routing logic
 * AROUND the classifier's decision (guest short-circuit, OTP-vs-session gating).
 * It never proves the decision itself. THIS file proves the decision: that a
 * natural-language task is classified into the right login strategy —
 *   - generic shopping            → an `agent` (throwaway) identity
 *   - tied to the user's records   → the user's own `connected_*` account
 *   - explicit "as a guest"        → `guest`, no login at all
 * This is the exact judgment that misroutes in practice (e.g. a flight booking
 * that should use the user's account but falls back to a guest/agent checkout).
 *
 * Self-skips unless LIVE_LLM=1 — it makes real, paid OpenRouter calls and reads
 * the connected inbox. Requires keys in .env (OPENROUTER_API_KEY, and
 * COMPOSIO_API_KEY for inbox evidence) and a built workspace (`pnpm build`,
 * for @tomo/core). Strategy is asserted at the category level (connected_otp and
 * connected_session both mean "the user's account") so the eval stays stable
 * regardless of whether the user's Gmail is connected at run time.
 *
 *   LIVE_LLM=1 pnpm vitest run packages/identity/tests/resolver.live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LoginStrategy } from "@tomo/core";
import { resolveStrategy } from "../src/resolver.js";

const LIVE = process.env.LIVE_LLM === "1";

/** The decision that matters: whose account does the task need? */
type Category = "agent" | "connected" | "guest";

function categoryOf(strategy: LoginStrategy): Category {
  if (strategy === "guest") return "guest";
  if (strategy === "agent") return "agent";
  return "connected"; // connected_otp | connected_session
}

interface Case {
  name: string;
  task: string;
  domain: string;
  want: Category;
}

const CASES: Case[] = [
  // Generic shopping — any account (or guest) works → a throwaway agent identity.
  { name: "generic sneakers (NL)", task: "buy these blue running sneakers in my size", domain: "allbirds.com", want: "agent" },
  { name: "generic product (URL)", task: "buy this https://shop.example/products/mug", domain: "shop.example", want: "agent" },
  { name: "gift delivery", task: "order a dozen red roses for delivery on Friday", domain: "1800flowers.com", want: "agent" },

  // Tied to the USER's personal records → the user's own connected account.
  { name: "airline check-in", task: "check me into my Frontier flight tomorrow", domain: "flyfrontier.com", want: "connected" },
  { name: "view my orders", task: "show me my recent Amazon orders and reorder the coffee", domain: "amazon.com", want: "connected" },
  { name: "change my booking", task: "change the seat on my existing United booking", domain: "united.com", want: "connected" },
  { name: "loyalty account", task: "redeem the stars in my Starbucks rewards account", domain: "starbucks.com", want: "connected" },
  { name: "my Best Buy account", task: "buy this on my Best Buy account", domain: "bestbuy.com", want: "connected" },
  { name: "my Target orders", task: "reorder the paper towels from my Target account", domain: "target.com", want: "connected" },
  { name: "explicit account login", task: "log in to my account and buy these boots", domain: "thursdayboots.com", want: "connected" },

  // Explicit guest checkout — no login, no account (short-circuits before the LLM).
  { name: "as a guest", task: "buy this item and check out as a guest", domain: "shop.example", want: "guest" },
  { name: "without an account", task: "purchase this without creating an account", domain: "shop.example", want: "guest" },
];

describe.skipIf(!LIVE)("LIVE login classifier (real OpenRouter + Composio)", () => {
  let dir: string;
  const origDataDir = process.env.TOMO_DATA_DIR;

  beforeAll(() => {
    // Isolate identity/vault state so the eval never reads or writes ~/.tomo.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-resolver-live-"));
    process.env.TOMO_DATA_DIR = dir;
  });

  afterAll(() => {
    if (origDataDir === undefined) delete process.env.TOMO_DATA_DIR;
    else process.env.TOMO_DATA_DIR = origDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(CASES)(
    "$name → $want",
    async ({ task, domain, want }) => {
      const r = await resolveStrategy({ task, domain });
      expect(categoryOf(r.strategy), `task="${task}" resolved strategy=${r.strategy}`).toBe(want);
    },
    60_000,
  );
});
