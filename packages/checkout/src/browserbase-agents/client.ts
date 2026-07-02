/**
 * Browserbase Agents REST client (no SDK dependency — plain fetch, same style as
 * browserbase-session.ts). Browserbase Agents is a MANAGED service: Browserbase's
 * own agent/LLM drives a remote browser from a natural-language `task` and returns
 * structured, typed output. We only start runs and poll them — we never drive the
 * page ourselves here.
 *
 * Trust boundary: because the browser is remote, anything in the run body leaves
 * the machine. Card PAN/CVV/expiry and login secrets must NEVER appear in `task`
 * or `variables` (enforced structurally in task-builder.ts::assertNoCdpSecrets).
 */

import { getBrowserbaseKey } from "@tomo/core";

const BROWSERBASE_API = "https://api.browserbase.com/v1";

/** A `%name%` placeholder the agent fills without seeing the value inline. */
export interface AgentVariable {
  value: string;
  description?: string;
}

export interface AgentRunRequest {
  task: string;
  agentId?: string;
  resultSchema?: Record<string, unknown>;
  variables?: Record<string, AgentVariable>;
  browserSettings?: Record<string, unknown>;
}

export type AgentRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "STOPPED"
  | "TIMED_OUT";

export interface AgentRun {
  runId: string;
  agentId?: string;
  task?: string;
  status: AgentRunStatus;
  sessionId?: string;
  sandboxId?: string;
  resultSchema?: Record<string, unknown>;
  /** Present once the run finishes; conforms to the requested resultSchema. */
  result?: unknown;
  cause?: { code: string; message: string };
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

function requireKey(): string {
  const key = getBrowserbaseKey();
  if (!key) {
    throw new Error("Browserbase Agents requires BROWSERBASE_API_KEY");
  }
  return key;
}

/** Start an ad-hoc agent run. Returns the initial (usually PENDING) run. */
export async function startRun(body: AgentRunRequest): Promise<AgentRun> {
  const res = await fetch(`${BROWSERBASE_API}/agents/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": requireKey(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Browserbase Agents run-create ${res.status}: ${errBody.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as Partial<AgentRun>;
  if (!data.runId) {
    throw new Error("Browserbase Agents run-create returned no runId");
  }
  return data as AgentRun;
}

/** Fetch the current state of a run (for polling to a terminal state). */
export async function getRun(runId: string): Promise<AgentRun> {
  const res = await fetch(`${BROWSERBASE_API}/agents/runs/${runId}`, {
    headers: { "X-BB-API-Key": requireKey() },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Browserbase Agents get-run ${res.status}: ${errBody.slice(0, 300)}`,
    );
  }
  return (await res.json()) as AgentRun;
}
