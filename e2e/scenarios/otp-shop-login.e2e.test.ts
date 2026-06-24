/**
 * Tier 2 — personal-email OTP login, isolated at the login gate.
 *
 * The user signs in to their own account on a storefront that uses passwordless
 * email-OTP. The one-time code normally comes from the user's Gmail via Composio;
 * here we inject a FAKE Composio client so the code is deterministic without a
 * live mailbox (`withFakeComposio`). LOGIN_CHECKPOINT=1 stops the run as soon as
 * login advances — we exercise the login gate, not the whole checkout.
 *
 * What this proves (hard): no spend; the planner routed to the USER's account
 * (connected_*, never a throwaway agent / create_account); and — the prime
 * directive — the OTP code never lands in the run log/trace.
 *
 * Frontier-style soft checks for everything site/LLM-dependent (whether the real
 * site shows an OTP form, whether login completes), since that varies by site.
 *
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/otp-shop-login.e2e.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { ComposioClient } from "@tomo/identity";
import { OTP_SHOP_URL, TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize, withFakeComposio } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";

// A synthetic OTP code — never a real one. The far-future timestamp guarantees it
// passes the login executor's "arrived after we submitted the email" freshness gate.
const OTP_CODE = "482913";
const otpDomain = new URL(OTP_SHOP_URL).hostname.replace(/^www\./, "");

/** A connected Gmail that always yields one fresh verification email for the shop. */
const fakeComposio: ComposioClient = {
  isConnected: async () => true,
  listConnections: async () => [
    { provider: "gmail", email: "user@example.com", status: "connected" },
  ],
  searchEmail: async () => [
    {
      id: "otp-1",
      from: `no-reply@${otpDomain}`,
      subject: "Your verification code",
      snippet: "",
      received_at: "2999-01-01T00:00:00.000Z",
    },
  ],
  getMessage: async () => ({
    id: "otp-1",
    from: `no-reply@${otpDomain}`,
    subject: "Your verification code",
    body: `Your verification code is ${OTP_CODE}. It expires in 10 minutes.`,
  }),
  getProfileEmail: async () => "user@example.com",
};

describe.skipIf(!LIVE)("OTP-shop login (real browser, deterministic OTP, no spend)", () => {
  it("logs in via email OTP, parks at login, and never leaks the code", async () => {
    const traceDir = setupScenarioEnv("otp-shop-login", { loginCheckpoint: true });

    const r = await withFakeComposio(fakeComposio, () =>
      driveRun(TASKS.otpShop, (gate) => {
        // A session_token gate means the LLM preferred session over OTP — provide
        // nothing; reject so we don't hang (the trace still shows the routing).
        if (gate.type === "session_token") return "reject";
        // create_account would mean it misrouted to a throwaway agent.
        if (gate.type === "create_account") return "reject";
        return { approved: true };
      }),
    );

    console.log("\n" + summarize("otp-shop", r, traceDir) + "\n");

    // HARD invariants:
    expect(r.fundingIssued).toBe(false); // no spend, ever
    expect(r.gatesSeen).not.toContain("create_account"); // routed to the user's account
    expect(r.loginStrategy === undefined || r.loginStrategy.startsWith("connected")).toBe(true);

    // PRIME DIRECTIVE: the OTP code is filled via direct Playwright and must never
    // appear in the captured run log. Absence is always a valid assertion.
    const logPath = join(traceDir, "run.log");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
    expect(log).not.toContain(OTP_CODE);

    // SOFT: whether the real site shows an OTP form / login completes is site-
    // dependent — trace it rather than fail.
    if (r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(
        `  otp-shop did not park (status=${r.outcome.status}, strategy=${r.loginStrategy}); ` +
          `see trace: ${traceDir}`,
      );
    }
  }, 300_000);
});
