/**
 * Live E2E harness — drives the planner end-to-end with a REAL browser, in-process.
 *
 * Calls startRun/resumeRun directly (the same code path the /api/run route uses).
 * Runs in no-spend oversight mode: DRY_RUN_NO_SPEND=1 means confirm() never issues
 * an Agentcard and the checkout parks at the payment page — structurally unable to
 * spend. Each run writes a JSONL trace + screenshots under ./traces/<scenario>-<ts>/.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startRun, resumeRun } from "@tomo/planner";
import type { RunOutcome, Approval } from "@tomo/planner";
import { getRun } from "@tomo/core";
import type { RunGate, GateType, LoginStrategy } from "@tomo/core";

/** Per-scenario environment: headful Chrome, no-spend, dedicated trace dir. */
export function setupScenarioEnv(scenario: string): string {
  const dir = join(process.cwd(), "traces", `${scenario}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  process.env.DRY_RUN_NO_SPEND = "1";
  process.env.CHECKOUT_TRACE_DIR = dir;
  // Default to a visible window unless the caller pinned HEADLESS explicitly.
  if (process.env.HEADLESS === undefined) process.env.HEADLESS = "false";
  return dir;
}

export interface DriveResult {
  outcome: RunOutcome;
  /** Gate types encountered, in order — proves which strategy the planner chose. */
  gatesSeen: GateType[];
  /** True if an Agentcard was issued during the run (must be false in no-spend mode). */
  fundingIssued: boolean;
  /** Captured "[funding] issued…" log lines, if any. */
  fundingLines: string[];
  /** Parked checkpoint surfaced on a completed no-spend run. */
  parked?: { at?: string; observed_total?: string; session_id?: string };
  /** The login strategy the resolver chose (read from the persisted run context). */
  loginStrategy?: LoginStrategy;
}

/** Decision returned by a gate handler: an Approval, or "reject" to cancel the run. */
export type GateDecision = Approval | "reject";
export type GateHandler = (gate: RunGate, outcome: RunOutcome) => GateDecision;

/**
 * Run a task, handling each approval gate via `handler`, until the run completes,
 * fails, or the gate budget is exhausted. Captures funding logs to prove no spend.
 */
export async function driveRun(
  task: string,
  handler: GateHandler,
  maxGates = 6,
): Promise<DriveResult> {
  const gatesSeen: GateType[] = [];
  const fundingLines: string[] = [];

  // Capture the orchestrator's funding log line ("[funding] issued single-use…").
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[funding] issued")) fundingLines.push(line);
    origLog(...args);
  };

  try {
    let outcome = await startRun(task);
    let guard = 0;
    while (outcome.status === "awaiting_approval" && outcome.gate && guard++ < maxGates) {
      gatesSeen.push(outcome.gate.type);
      const decision = handler(outcome.gate, outcome);
      if (decision === "reject") {
        outcome = await resumeRun(outcome.run_id, { approved: false });
        break;
      }
      outcome = await resumeRun(outcome.run_id, decision);
    }

    const parked = (outcome.result?.parked ?? undefined) as DriveResult["parked"];
    // The resolved login strategy lives in the persisted run context — read it so
    // tests can assert routing even when the flow can't complete (e.g. a non-product
    // site where the purchase step can't build a quote).
    const run = getRun(outcome.run_id);
    const loginStrategy = (run?.context as { login?: { strategy?: LoginStrategy } } | undefined)
      ?.login?.strategy;
    return {
      outcome,
      gatesSeen,
      fundingIssued: fundingLines.length > 0,
      fundingLines,
      parked,
      loginStrategy,
    };
  } finally {
    console.log = origLog;
  }
}

/** Pretty one-line summary for the test console + the trace dir pointer. */
export function summarize(label: string, r: DriveResult, traceDir: string): string {
  const lines = [
    `[${label}] status=${r.outcome.status} strategy=${r.loginStrategy ?? "?"} gates=[${r.gatesSeen.join(", ")}]`,
    `  funding_issued=${r.fundingIssued}`,
    r.parked ? `  PARKED at ${r.parked.at}, observed_total=${r.parked.observed_total ?? "?"}` : "  (did not park)",
    r.outcome.error ? `  error=${r.outcome.error.code}: ${r.outcome.error.message}` : "",
    `  trace: ${traceDir}`,
  ].filter(Boolean);
  return lines.join("\n");
}
