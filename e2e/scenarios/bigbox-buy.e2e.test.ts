/**
 * Tier 3 — a big-box retailer (Best Buy by default; point elsewhere via
 * E2E_BIGBOX_URL) exercised BOTH ways on a site other than the canary, proving
 * the login paths are site-agnostic:
 *   - agent path:     "create an account and buy" → agent identity + create_account
 *   - connected path: "buy this on my <retailer> account" → the user's account
 *
 * Both park (DRY_RUN_NO_SPEND) — nothing is spent. Big-box sites have bot
 * defenses, so reaching payment is SOFT; only no-spend + identity routing are hard.
 *
 *   E2E_LIVE=1 E2E_BIGBOX_URL=<current product url> \
 *     pnpm vitest run e2e/scenarios/bigbox-buy.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";
const SESSION_TOKEN = process.env.E2E_BIGBOX_SESSION_TOKEN;

describe.skipIf(!LIVE)("Big-box retailer checkout (real browser, no spend)", () => {
  it("agent path: creates a throwaway account and drives toward payment", async () => {
    const traceDir = setupScenarioEnv("bigbox-agent");

    const r = await driveRun(TASKS.bigBoxAgent, (gate) => {
      if (gate.type === "purchase_confirm") return { approved: true };
      // The agent path SHOULD see create_account; approving it is the intent.
      if (gate.type === "create_account") return { approved: true };
      // A session_token gate here would mean it misrouted to the user's account.
      if (gate.type === "session_token") return "reject";
      return { approved: true };
    });

    console.log("\n" + summarize("bigbox-agent", r, traceDir) + "\n");

    expect(r.fundingIssued).toBe(false);
    expect(r.gatesSeen).toContain("create_account");
    expect(r.loginStrategy).toBe("agent");

    if (r.outcome.status === "completed" && r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(`  bigbox-agent did not park (status=${r.outcome.status}); see trace: ${traceDir}`);
    }
  }, 300_000);

  it("connected path: logs in as the user and drives toward payment", async () => {
    const traceDir = setupScenarioEnv("bigbox-user");

    const r = await driveRun(TASKS.bigBoxUser, (gate) => {
      if (gate.type === "session_token") {
        return SESSION_TOKEN ? { approved: true, session_token: SESSION_TOKEN } : "reject";
      }
      if (gate.type === "purchase_confirm") return { approved: true };
      // create_account would mean it misrouted to a throwaway agent.
      if (gate.type === "create_account") return "reject";
      return { approved: true };
    });

    console.log("\n" + summarize("bigbox-user", r, traceDir) + "\n");

    expect(r.fundingIssued).toBe(false);
    expect(r.gatesSeen).not.toContain("create_account");
    // If a strategy resolved it must be the user's account; on a hardened site the
    // run can die before login resolves (undefined) — soft, not a misroute.
    if (r.loginStrategy) {
      expect(["connected_otp", "connected_session"]).toContain(r.loginStrategy);
    }

    if (r.outcome.status === "completed" && r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(`  bigbox-user did not park (status=${r.outcome.status}); see trace: ${traceDir}`);
    }
  }, 300_000);
});
