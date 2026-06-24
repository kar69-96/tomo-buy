/**
 * Tier 3 — full end-to-end on the user's own Amazon account → park at payment.
 *
 * "Reorder this on my Amazon account" ties the task to the user's records, so the
 * resolver picks a connected-account strategy (OTP via Gmail, or a session token).
 * The real browser logs in and drives toward the payment page, then parks
 * (DRY_RUN_NO_SPEND) — nothing is spent.
 *
 * Amazon has strong bot defenses, so reaching payment is a SOFT outcome: a
 * bot-block / non-park is expected and traced, not a failure. Only no-spend and
 * the identity routing are hard-asserted.
 *
 *   E2E_LIVE=1 E2E_AMAZON_URL=<current product url> \
 *     pnpm vitest run e2e/scenarios/amazon-user-account.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";
const SESSION_TOKEN = process.env.E2E_AMAZON_SESSION_TOKEN;

describe.skipIf(!LIVE)("Amazon user-account checkout (real browser, no spend)", () => {
  it("logs in as the user and drives toward payment without spending", async () => {
    const traceDir = setupScenarioEnv("amazon-user-account");

    const r = await driveRun(TASKS.amazonUser, (gate) => {
      if (gate.type === "session_token") {
        return SESSION_TOKEN ? { approved: true, session_token: SESSION_TOKEN } : "reject";
      }
      if (gate.type === "purchase_confirm") {
        console.log("  [oversight] purchase_confirm:", JSON.stringify(gate.details));
        return { approved: true };
      }
      // create_account would mean it misrouted to a throwaway agent.
      if (gate.type === "create_account") return "reject";
      return { approved: true };
    });

    console.log("\n" + summarize("amazon", r, traceDir) + "\n");

    // HARD invariants (always in our control):
    expect(r.fundingIssued).toBe(false); // no spend, ever
    expect(r.gatesSeen).not.toContain("create_account"); // never a throwaway agent
    // Routing: if a strategy resolved, it must be the USER's account. On a
    // maximally-hostile site the run can die during discovery before login
    // resolves (loginStrategy undefined) — that's a soft outcome, not a misroute.
    if (r.loginStrategy) {
      expect(["connected_otp", "connected_session"]).toContain(r.loginStrategy);
    }

    // SOFT: Amazon will likely bot-block before payment — accepted outcome.
    if (r.outcome.status === "completed" && r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(
        `  amazon run did not park (status=${r.outcome.status}, strategy=${r.loginStrategy}); ` +
          `expected on a hardened site. See trace: ${traceDir}`,
      );
    }
  }, 300_000);
});
