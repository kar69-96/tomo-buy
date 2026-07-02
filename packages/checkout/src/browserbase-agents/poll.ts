/**
 * Poll a Browserbase Agents run to a terminal state. Runs are asynchronous, so we
 * poll GET /agents/runs/{id} until COMPLETED/FAILED/STOPPED/TIMED_OUT or timeout.
 *
 * The clock, sleep, and fetch are injectable so the loop is unit-testable without
 * real timers or network.
 */

import { getRun, type AgentRun, type AgentRunStatus } from "./client.js";

const TERMINAL: ReadonlySet<AgentRunStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "STOPPED",
  "TIMED_OUT",
]);

export function isTerminal(status: AgentRunStatus): boolean {
  return TERMINAL.has(status);
}

export interface PollOptions {
  /** Hard ceiling; throws once exceeded without reaching a terminal state. */
  timeoutMs: number;
  intervalMs?: number;
  log?: (msg: string) => void;
  /** Injectable clock (defaults to Date.now). */
  now?: () => number;
  /** Injectable sleep (defaults to setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable run fetcher (defaults to the REST client). */
  fetchRun?: (runId: string) => Promise<AgentRun>;
}

export async function pollRun(
  runId: string,
  opts: PollOptions,
): Promise<AgentRun> {
  const intervalMs = opts.intervalMs ?? 2000;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchRun = opts.fetchRun ?? getRun;

  const start = now();
  for (;;) {
    const run = await fetchRun(runId);
    if (isTerminal(run.status)) return run;
    if (now() - start >= opts.timeoutMs) {
      throw new Error(
        `Browserbase Agents run ${runId} did not finish within ${opts.timeoutMs}ms (last status: ${run.status})`,
      );
    }
    opts.log?.(`  [bb-agents] run ${runId} status=${run.status}, polling…`);
    await sleep(intervalMs);
  }
}
