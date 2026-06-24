/**
 * Tier 2 — personal-email OTP login on the user's real account (Frontier),
 * isolated at the login gate.
 *
 * Unlike otp-shop-login (which injects a fake mailbox), this runs the REAL
 * Composio path: with COMPOSIO_API_KEY set + the user's Gmail connected, the
 * resolver should pick `connected_otp` and the login executor reads the live
 * code. LOGIN_CHECKPOINT=1 stops as soon as login advances.
 *
 * Frontier has aggressive bot defenses and this is a real account, so only the
 * invariants we control are hard-asserted (no spend, the user's account was
 * chosen, no agent create_account). Everything else is traced.
 *
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/frontier-otp-login.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";
const SESSION_TOKEN = process.env.E2E_FRONTIER_SESSION_TOKEN;

describe.skipIf(!LIVE)("Frontier OTP login (real browser, login checkpoint, no spend)", () => {
  it("signs in as the user (OTP preferred) and parks at the login checkpoint", async () => {
    const traceDir = setupScenarioEnv("frontier-otp-login", { loginCheckpoint: true });

    const r = await driveRun(TASKS.frontier, (gate) => {
      // If the resolver fell back to a session token (Gmail not connected), use
      // E2E_FRONTIER_SESSION_TOKEN when provided; otherwise reject so we don't hang.
      if (gate.type === "session_token") {
        return SESSION_TOKEN ? { approved: true, session_token: SESSION_TOKEN } : "reject";
      }
      // create_account would mean the resolver misrouted to a throwaway agent.
      if (gate.type === "create_account") return "reject";
      return { approved: true };
    });

    console.log("\n" + summarize("frontier-otp", r, traceDir) + "\n");

    // HARD invariants:
    expect(r.fundingIssued).toBe(false);
    expect(r.gatesSeen).not.toContain("create_account");
    expect(["connected_otp", "connected_session"]).toContain(r.loginStrategy);

    // SOFT: bot defenses / login availability vary — trace how far we got.
    if (r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(
        `  frontier-otp did not park (status=${r.outcome.status}, strategy=${r.loginStrategy}); ` +
          `expected on a hardened site. See trace: ${traceDir}`,
      );
    }
  }, 300_000);
});
