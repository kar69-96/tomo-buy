/**
 * Scenario 3 — NEW agent account.
 *
 * "Create an account and buy <url>" → resolver picks an `agent` identity and gates
 * on `create_account` (first time on the domain). After approval the real browser
 * registers the agent account (AgentMail inbox + vaulted password), then drives to
 * the payment page and parks. Nothing is spent.
 *
 * Requires AGENTMAIL_API_KEY + VAULT_KEY for a real registration.
 *
 * Run live (headful):
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/new-agent-account.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";

describe.skipIf(!LIVE)("new agent account (real browser, no spend)", () => {
  it("approves create_account then parks at payment", async () => {
    const traceDir = setupScenarioEnv("new-agent-account");

    const r = await driveRun(TASKS.newAccount, (gate) => {
      if (gate.type === "create_account") {
        console.log("  [oversight] create_account:", JSON.stringify(gate.details));
        return { approved: true }; // register a new throwaway agent account
      }
      if (gate.type === "purchase_confirm") {
        console.log("  [oversight] purchase_confirm:", JSON.stringify(gate.details));
        return { approved: true };
      }
      return { approved: true };
    });

    console.log("\n" + summarize("new-account", r, traceDir) + "\n");

    // HARD invariants:
    expect(r.fundingIssued).toBe(false);
    expect(r.gatesSeen).toContain("create_account"); // proves the new-account path
    expect(r.gatesSeen).toContain("purchase_confirm");

    // SOFT: real registration + checkout may not reach payment; trace either way.
    if (r.outcome.status === "completed" && r.parked) {
      expect(r.parked.at).toBe("payment");
    } else {
      console.warn(`  new-account run did not reach payment (status=${r.outcome.status}); see trace: ${traceDir}`);
    }
  }, 300_000);
});
