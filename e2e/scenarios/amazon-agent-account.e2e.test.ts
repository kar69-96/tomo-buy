/**
 * Amazon — agent account (real browser, no spend).
 *
 * "Create an account and buy this item" → the resolver picks an `agent` identity
 * and gates on `create_account`. After approval the real browser registers a fresh
 * agent account on Amazon using the existing Tomo AgentMail inbox + a new vaulted
 * per-site password (the LLM never sees the password), drives toward the payment
 * page, and parks. Nothing is spent (DRY_RUN_NO_SPEND).
 *
 * Amazon offers no guest checkout and has strong bot defenses, so it naturally
 * forces the account-creation path. Reaching payment is a SOFT outcome — bot
 * blocks are expected and traced, not a failure. Only no-spend and the agent
 * routing are hard-asserted.
 *
 * Run live against YOUR real Chrome (real fingerprint, bypasses bot detection) —
 * the intended local test mode (prod uses Browserbase stealth). Two transports:
 *
 *   A) Profile mode (recommended locally — works on current Chrome):
 *      E2E_LIVE=1 CUA_MODE=tool-calling \
 *        BROWSER_PROFILE_DIR=/tmp/chrome-tomo-agent-profile HEADLESS=false \
 *        pnpm vitest run e2e/scenarios/amazon-agent-account.e2e.test.ts
 *
 *   B) CDP attach (BROWSER_CDP_URL=http://localhost:9222 against a Chrome started
 *      with --remote-debugging-port=9222). NOTE: Playwright connectOverCDP currently
 *      fails on Chrome 149 ("Browser.setDownloadBehavior: Browser context management
 *      is not supported"); use profile mode until that's resolved.
 *
 * CUA_MODE=tool-calling forces the OpenRouter AGENT_MODEL path: the native Anthropic
 * computer-use tool is NOT supported by the configured models (Sonnet 4.6 / Opus 4.8),
 * so the tool-calling CUA (click/type/scroll via DOM refs) is the working driver here.
 *
 * The default product ASIN goes out of stock over time — override with a current,
 * in-stock, Amazon-sold item:
 *   E2E_AMAZON_URL=<current amazon product url>
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";
import { deleteSiteAccount } from "@tomo/core";
import { getOrCreateAgentIdentity } from "@tomo/identity";

const LIVE = process.env.E2E_LIVE === "1";

describe.skipIf(!LIVE)("Amazon — agent account (real browser, no spend)", () => {
  beforeEach(async () => {
    // Clean slate: reuse the existing AgentMail identity, but drop any prior
    // amazon.com site account so the resolver always gates on create_account and
    // a fresh per-site password is minted this run.
    const identity = await getOrCreateAgentIdentity();
    await deleteSiteAccount(identity.identity_id, "amazon.com");
  });

  it("creates a throwaway account and parks at payment", async () => {
    const traceDir = setupScenarioEnv("amazon-agent-account");

    const r = await driveRun(TASKS.amazonAgent, (gate) => {
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

    console.log("\n" + summarize("amazon-agent-account", r, traceDir) + "\n");

    // HARD invariants (always in our control):
    expect(r.fundingIssued).toBe(false); // no spend, ever
    expect(r.gatesSeen).toContain("create_account"); // chose the create-account path
    expect(r.loginStrategy).toBe("agent"); // agent identity, not the user/guest

    // SOFT: Amazon may bot-block before payment — accepted outcome, traced either way.
    if (r.outcome.status === "completed" && r.parked) {
      expect(["login", "payment"]).toContain(r.parked.at);
    } else {
      console.warn(
        `  amazon agent run did not park (status=${r.outcome.status}); ` +
          `expected on a hardened site. See trace: ${traceDir}`,
      );
    }
  }, 300_000);
});
