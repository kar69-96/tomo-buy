/**
 * Planning agent — turns a natural-language task into an ordered ExecutionPlan
 * over the capability registry. Uses an LLM when configured, with a
 * deterministic fallback so the planner is robust offline and in tests.
 */
import type { ExecutionPlan, PlanStep } from "@tomo/core";
import { completeJson, getOpenRouterKey } from "@tomo/identity";
import { describeCapabilities } from "./capabilities.js";

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/i;

export function extractUrl(task: string): string | null {
  const m = task.match(URL_RE);
  return m ? m[0].replace(/[.,)]+$/, "") : null;
}

const SYSTEM_PROMPT = `You are a planning agent for browser-automation tasks. Given a task, produce an ordered plan using ONLY these capabilities:

%CAPS%

Return STRICT JSON: {"steps": [{"capability": string, "args": object}]}

Guidance:
- For buying a specific product URL: [discover(url), login(domain), purchase(url)].
- For a natural-language shopping request with no URL: [discover(query)] only — a human picks the product before purchase.
- Always insert a "login" step before "purchase" when the site may gate checkout.
- Keep the plan minimal and efficient. Do not invent capabilities.`;

interface RawPlan {
  steps: Array<{ capability: string; args?: Record<string, unknown> }>;
}

/** Deterministic plan used as a fallback and as a safe default. */
export function fallbackPlan(task: string): ExecutionPlan {
  const url = extractUrl(task);
  if (url) {
    const domain = safeDomain(url);
    const steps: PlanStep[] = [
      { capability: "discover", args: { url } },
      { capability: "login", args: { domain } },
      { capability: "purchase", args: { url }, gate: "purchase_confirm" },
    ];
    return { task, steps };
  }
  return { task, steps: [{ capability: "discover", args: { query: task } }] };
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const VALID = new Set(["discover", "login", "purchase"]);

export async function plan(task: string): Promise<ExecutionPlan> {
  if (!getOpenRouterKey()) return fallbackPlan(task);

  try {
    const raw = await completeJson<RawPlan>(
      SYSTEM_PROMPT.replace("%CAPS%", describeCapabilities()),
      `Task: ${task}`,
      { temperature: 0, maxTokens: 400 },
    );
    const steps = (raw?.steps ?? [])
      .filter((s) => VALID.has(s.capability))
      .map((s) => normalizeStep(s, task));
    if (steps.length === 0) return fallbackPlan(task);
    return { task, steps };
  } catch {
    return fallbackPlan(task);
  }
}

function normalizeStep(
  s: { capability: string; args?: Record<string, unknown> },
  task: string,
): PlanStep {
  const args = { ...(s.args ?? {}) };
  // Backfill a domain for login steps from any url in args or the task.
  if (s.capability === "login" && !args.domain) {
    const url = (args.url as string) ?? extractUrl(task);
    if (url) args.domain = safeDomain(url);
  }
  const step: PlanStep = { capability: s.capability, args };
  if (s.capability === "purchase") step.gate = "purchase_confirm";
  return step;
}
