import { Hono } from "hono";
import { TomoError, ErrorCodes } from "@tomo/core";
import { startRun, resumeRun } from "@tomo/planner";
import type { RunOutcome } from "@tomo/planner";

export const runRoutes = new Hono();

function formatOutcome(outcome: RunOutcome) {
  // Consistent envelope: status drives what the caller does next.
  return {
    run_id: outcome.run_id,
    status: outcome.status,
    ...(outcome.gate ? { gate: outcome.gate } : {}),
    ...(outcome.result ? { result: outcome.result } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

// POST /api/run — plan + execute a task; may pause on an approval gate.
runRoutes.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (!body.task || typeof body.task !== "string" || body.task.trim() === "") {
    throw new TomoError(ErrorCodes.MISSING_FIELD, "task is required");
  }

  const outcome = await startRun(body.task.trim());
  return c.json(formatOutcome(outcome));
});

// POST /api/run/:id/approve — approve/reject the current gate and resume.
runRoutes.post("/run/:id/approve", async (c) => {
  const runId = c.req.param("id");
  if (!runId) {
    throw new TomoError(ErrorCodes.MISSING_FIELD, "run id is required");
  }

  const body = await c.req.json().catch(() => ({}));
  const outcome = await resumeRun(runId, {
    approved: body.approved,
    session_token:
      typeof body.session_token === "string" ? body.session_token : undefined,
    cookie_name:
      typeof body.cookie_name === "string" ? body.cookie_name : undefined,
  });

  if (outcome.status === "failed" && outcome.error?.code === "RUN_NOT_FOUND") {
    throw new TomoError(ErrorCodes.RUN_NOT_FOUND, `No run ${runId}`);
  }
  if (outcome.status === "failed" && outcome.error?.code === "RUN_INVALID_STATE") {
    throw new TomoError(
      ErrorCodes.RUN_INVALID_STATE,
      `Run ${runId} is not awaiting approval`,
    );
  }

  return c.json(formatOutcome(outcome));
});
