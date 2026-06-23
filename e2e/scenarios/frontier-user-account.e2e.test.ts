/**
 * Scenario 1 — SIGN IN to the user's existing account (Frontier Airlines).
 *
 * "Check in to my Frontier flight" ties the task to the user's personal records,
 * so the resolver picks a connected-account strategy:
 *   - connected_otp  → login via a code read from the user's connected Gmail (no gate)
 *   - connected_session → a `session_token` gate (provide E2E_FRONTIER_SESSION_TOKEN)
 *
 * The real browser logs in as the user, then drives toward payment and parks. Nothing
 * is spent. Frontier has aggressive bot defenses, so this scenario hard-asserts only
 * the invariants it controls (no spend, the connected-account strategy was chosen) and
 * traces the rest.
 *
 * Run live (headful):
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/frontier-user-account.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";
const SESSION_TOKEN = process.env.E2E_FRONTIER_SESSION_TOKEN;

describe.skipIf(!LIVE)("Frontier user-account login (real browser, no spend)", () => {
  it("logs in as the user (OTP or session token) and never spends", async () => {
    const traceDir = setupScenarioEnv("frontier-user-account");

    const r = await driveRun(TASKS.frontier, (gate) => {
      if (gate.type === "session_token") {
        if (SESSION_TOKEN) {
          console.log("  [oversight] session_token: providing E2E_FRONTIER_SESSION_TOKEN");
          return { approved: true, session_token: SESSION_TOKEN };
        }
        // No token available — reject so we don't hang; the trace still shows routing.
        console.warn("  [oversight] session_token gate but no E2E_FRONTIER_SESSION_TOKEN; rejecting");
        return "reject";
      }
      if (gate.type === "purchase_confirm") {
        console.log("  [oversight] purchase_confirm:", JSON.stringify(gate.details));
        return { approved: true };
      }
      // create_account would mean the resolver misrouted — reject to surface it.
      if (gate.type === "create_account") return "reject";
      return { approved: true };
    });

    console.log("\n" + summarize("frontier", r, traceDir) + "\n");

    // HARD invariants — these are what this scenario actually proves:
    //  1. No spend, ever.
    expect(r.fundingIssued).toBe(false);
    //  2. The planner recognized "my Frontier account" and chose the USER's account,
    //     NOT a throwaway agent or guest. (This is the core identity-routing decision.)
    expect(r.gatesSeen).not.toContain("create_account");
    expect(["connected_otp", "connected_session"]).toContain(r.loginStrategy);

    // SOFT: this product-purchase backend can't model a flight booking/check-in, and
    // Frontier blocks automation — so the flow won't reach a payment page. The trace
    // captures exactly how far the connected-account login got.
    if (r.outcome.status === "completed" && r.parked) {
      expect(r.parked.at).toBe("payment");
    } else {
      console.warn(
        `  frontier run did not park (status=${r.outcome.status}, strategy=${r.loginStrategy}); ` +
          `expected for a non-product flow. See trace: ${traceDir}`,
      );
    }
  }, 300_000);
});
