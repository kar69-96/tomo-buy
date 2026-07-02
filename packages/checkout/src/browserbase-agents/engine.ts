/**
 * Browserbase Agents checkout engine — the primary checkout driver when
 * BROWSER_BACKEND=browserbase-agents (and a key is set).
 *
 * Browserbase's managed agent drives a REMOTE browser from a natural-language
 * task and returns structured output. Because that browser is remote, the card
 * can never be entered here without the PAN leaving for Browserbase's cloud — so
 * this engine drives to the payment page and PARKS (parkedAtPayment). The paid
 * card step is completed by the local CDP engine (see orchestrator/confirm.ts).
 *
 * This engine never receives or forwards `input.card`.
 */

import { getAgentRunTimeoutMs } from "@tomo/core";
import type { CheckoutInput, CheckoutResult } from "../task.js";
import { replayUrlFor } from "../browserbase-session.js";
import { startRun } from "./client.js";
import { pollRun } from "./poll.js";
import { buildAgentTask } from "./task-builder.js";
import { AGENT_RESULT_SCHEMA, AgentResultSchema } from "./result-schema.js";

export async function runCheckoutViaBrowserbaseAgents(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const log = (msg: string) => console.log(msg);
  const { task, variables } = buildAgentTask(input);

  log("[bb-agents] starting run (drive to payment page, never enter card)");
  const started = await startRun({
    task,
    variables,
    resultSchema: AGENT_RESULT_SCHEMA,
    browserSettings: { proxies: true },
  });

  const run = await pollRun(started.runId, {
    timeoutMs: getAgentRunTimeoutMs(),
    log,
  });

  const sessionId = run.sessionId ?? started.sessionId ?? started.runId;
  const replayUrl = run.sessionId ? replayUrlFor(run.sessionId) : "";

  if (run.status !== "COMPLETED") {
    return {
      success: false,
      sessionId,
      replayUrl,
      errorMessage:
        run.cause?.message ?? `Browserbase Agents run ${run.status}`,
    };
  }

  const parsed = AgentResultSchema.safeParse(run.result);
  if (!parsed.success) {
    return {
      success: false,
      sessionId,
      replayUrl,
      errorMessage: `Browserbase Agents returned a malformed result: ${parsed.error.message.slice(
        0,
        200,
      )}`,
    };
  }

  const result = parsed.data;
  if (result.status !== "reached_payment") {
    return {
      success: false,
      sessionId,
      replayUrl,
      errorMessage:
        result.blocked_reason ??
        `Browserbase Agents did not reach payment (status: ${result.status})`,
    };
  }

  // Reached the payment page and parked — no card was ever entered.
  return {
    success: true,
    sessionId,
    replayUrl,
    finalTotal: result.observed_total || undefined,
    parkedAtPayment: true,
  };
}
