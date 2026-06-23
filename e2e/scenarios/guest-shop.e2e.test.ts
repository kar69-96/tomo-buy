/**
 * Scenario 2 — GUEST checkout.
 *
 * "Buy <url> as a guest" → resolver returns the `guest` strategy (no login, no
 * account, no gate). The real browser drives discovery → cart → shipping → payment
 * and parks before placing the order. Nothing is spent.
 *
 * Run live (headful):
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/guest-shop.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";

describe.skipIf(!LIVE)("guest checkout (real browser, no spend)", () => {
  it("parks at payment as a guest without creating an account", async () => {
    const traceDir = setupScenarioEnv("guest-shop");

    const r = await driveRun(TASKS.guest, (gate) => {
      if (gate.type === "purchase_confirm") {
        // Overseer step: inspect the price breakdown before letting it proceed.
        console.log("  [oversight] purchase_confirm:", JSON.stringify(gate.details));
        return { approved: true }; // proceeds into the no-spend parked checkout
      }
      // A guest run should never hit create_account / session_token.
      return { approved: true };
    });

    console.log("\n" + summarize("guest", r, traceDir) + "\n");

    // HARD invariants:
    expect(r.fundingIssued).toBe(false); // no Agentcard ever issued
    expect(r.gatesSeen).not.toContain("create_account"); // proves guest, not new-account
    expect(r.gatesSeen).not.toContain("session_token");
    expect(r.gatesSeen).toContain("purchase_confirm");

    // SOFT (real site / bot defenses may block before payment): trace either way.
    if (r.outcome.status === "completed" && r.parked) {
      expect(r.parked.at).toBe("payment");
      expect(r.parked.observed_total ?? "").not.toBe("");
    } else {
      console.warn(`  guest run did not reach payment (status=${r.outcome.status}); see trace: ${traceDir}`);
    }
  }, 300_000);
});
