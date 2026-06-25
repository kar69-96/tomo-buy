/**
 * Best Buy — AirPods, agent account.
 *
 * "Create an account and buy AirPods" → resolver picks an `agent` identity and
 * gates on `create_account`. After approval the real browser registers an agent
 * account (AgentMail inbox + vaulted password), drives to the payment page, and
 * parks. Nothing is spent (DRY_RUN_NO_SPEND).
 *
 * Run live (headful):
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/bestbuy-airpods-agent.e2e.test.ts
 *
 * Override the product URL if stock changes:
 *   E2E_LIVE=1 E2E_BIGBOX_URL=<current-bestbuy-airpods-url> \
 *     pnpm vitest run e2e/scenarios/bestbuy-airpods-agent.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";

const AIRPODS_URL =
  process.env.E2E_BIGBOX_URL ??
  "https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation-with-magsafe-case-usb-c/6447382.p";

const TASK = `Create an account and buy this item: ${AIRPODS_URL}`;

describe.skipIf(!LIVE)("Best Buy AirPods — agent account (real browser, no spend)", () => {
  it("creates a throwaway account and parks at payment", async () => {
    const traceDir = setupScenarioEnv("bestbuy-airpods-agent");

    const r = await driveRun(TASK, (gate) => {
      if (gate.type === "create_account") {
        console.log("  [oversight] create_account:", JSON.stringify(gate.details));
        return { approved: true };
      }
      if (gate.type === "purchase_confirm") {
        console.log("  [oversight] purchase_confirm:", JSON.stringify(gate.details));
        return { approved: true };
      }
      // Reject any session_token gate — this is the agent path, not the user's account.
      if (gate.type === "session_token") return "reject";
      return { approved: true };
    });

    console.log("\n" + summarize("bestbuy-airpods-agent", r, traceDir) + "\n");

    // HARD invariants
    expect(r.fundingIssued).toBe(false);
    expect(r.gatesSeen).toContain("create_account");
    expect(r.loginStrategy).toBe("agent");

    // SOFT: bot defenses may prevent reaching payment; trace either way.
    if (r.outcome.status === "completed" && r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(
        `  run did not park (status=${r.outcome.status}); see trace: ${traceDir}`,
      );
    }
  }, 300_000);
});
