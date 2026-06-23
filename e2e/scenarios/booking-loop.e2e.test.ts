/**
 * Booking-loop harness — a generic, report-only oversight run that drives ANY
 * booking/purchase task to the payment page and parks (no spend). Used to iterate
 * on the planner + brief-driven executor.
 *
 * Nothing here is task-specific: it drives `E2E_LOOP_TASK` (defaulting to the
 * Frontier booking fixture only because that's a convenient real booking site),
 * and the gate handler is generic — it approves the price-confirm gate and, when
 * no real session token is available, proceeds WITHOUT one (guest path) so the
 * booking can still reach payment. Provide E2E_FRONTIER_SESSION_TOKEN to log in
 * as the real user instead.
 *
 * Run:
 *   E2E_LIVE=1 pnpm vitest run e2e/scenarios/booking-loop.e2e.test.ts
 *   E2E_LIVE=1 E2E_LOOP_TASK="Book a one-way ... at https://..." pnpm vitest run e2e/scenarios/booking-loop.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { TASKS } from "../fixtures.js";
import { setupScenarioEnv, driveRun, summarize } from "../harness.js";

const LIVE = process.env.E2E_LIVE === "1";
const TASK = process.env.E2E_LOOP_TASK ?? TASKS.frontier;
const SESSION_TOKEN = process.env.E2E_FRONTIER_SESSION_TOKEN;
// A full booking (search → results → fare → pax → seats/bags → payment) spans
// many LLM-driven pages; the default 5-min budget is too tight. Overridable.
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 900_000);

describe.skipIf(!LIVE)("Booking loop (brief-driven, no spend)", () => {
  it("drives a booking task toward the payment page and parks", async () => {
    const traceDir = setupScenarioEnv("booking-loop");

    const r = await driveRun(TASK, (gate) => {
      if (gate.type === "session_token") {
        if (SESSION_TOKEN) {
          console.log("  [oversight] session_token: providing E2E_FRONTIER_SESSION_TOKEN");
          return { approved: true, session_token: SESSION_TOKEN };
        }
        // No token — approve WITHOUT one so the booking proceeds as a guest to the
        // payment page (the goal: reach 'about to click buy'). Generic, not task-specific.
        console.log("  [oversight] session_token gate with no token; proceeding as guest");
        return { approved: true };
      }
      // Approve the price-confirm gate (no spend: DRY_RUN_NO_SPEND parks at payment).
      if (gate.type === "purchase_confirm") {
        console.log("  [oversight] purchase_confirm:", JSON.stringify(gate.details));
        return { approved: true };
      }
      // create_account would register a throwaway account — approve so a generic
      // shop flow isn't blocked; the trace records it either way.
      return { approved: true };
    });

    console.log("\n" + summarize("booking-loop", r, traceDir) + "\n");

    // Report-only: no hard assertions on reaching payment (sites vary / bot-defend).
    // The ONLY invariant is the structural one — a no-spend run never funds a card.
    expect(r.fundingIssued).toBe(false);
  }, TIMEOUT_MS);
});
