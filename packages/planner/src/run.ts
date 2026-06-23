/**
 * Run executor — drives an ExecutionPlan step by step, pausing at human-approval
 * gates and resuming after the caller approves.
 *
 * SECURITY: the persisted run context (~/.tomo/runs.json) NEVER contains a
 * plaintext password or session token. It stores only the resolved strategy and
 * opaque vault refs. The LoginPlan (which carries the actual secret) is rebuilt
 * from the vault just-in-time right before checkout and never persisted.
 */
import {
  type Run,
  type RunGate,
  type GateType,
  type LoginStrategy,
  type ExecutionPlan,
  type ExecutionBrief,
  type PlanStep,
  generateId,
  createRun,
  getRun,
  updateRun,
  getAgentcardBufferPct,
  getAgentcardMaxAmount,
} from "@tomo/core";
import { query, searchQuery, buy, confirm } from "@tomo/orchestrator";
import {
  resolveStrategy,
  getAgentIdentity,
  getOrCreateSiteAccount,
  putSecret,
  getSecret,
} from "@tomo/identity";
import type { LoginPlan, SessionCookie } from "@tomo/checkout";
import { plan as makePlan } from "./plan.js";

// ---- Execution context (persisted; secrets excluded) ----

interface LoginState {
  strategy: LoginStrategy;
  email: string;
  identity_id?: string;
  register?: boolean;
  pending_gate?: GateType;
  session_token_ref?: string; // vault ref, never the token itself
  cookie_name?: string;
}

interface PurchaseState {
  order_id: string;
  approved: boolean;
  pending_gate?: GateType;
  breakdown?: Record<string, unknown>;
  /** Set when a no-spend oversight run (DRY_RUN_NO_SPEND) parked at the payment page. */
  parked?: Record<string, unknown>;
}

interface RunContext {
  task: string;
  url?: string;
  domain?: string;
  discovery?: Record<string, unknown>;
  login?: LoginState;
  purchase?: PurchaseState;
  receipt?: Record<string, unknown>;
  [key: string]: unknown;
}

function readContext(run: Run): RunContext {
  return (run.context ?? { task: run.task }) as unknown as RunContext;
}

// ---- Approval payloads ----

export interface Approval {
  approved?: boolean;
  /** Raw session token for a connected_session login (stored in the vault). */
  session_token?: string;
  /** Cookie name to carry the token (defaults to "session"). */
  cookie_name?: string;
}

export interface RunOutcome {
  run_id: string;
  status: Run["status"];
  gate?: RunGate;
  /** High-detail execution brief the planner produced for this run. */
  brief?: ExecutionBrief;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Public API ----

export async function startRun(task: string): Promise<RunOutcome> {
  const execPlan: ExecutionPlan = await makePlan(task);
  const run: Run = {
    run_id: generateId("run"),
    task,
    status: "running",
    plan: execPlan,
    cursor: 0,
    context: { task } satisfies RunContext,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await createRun(run);
  return advance(run);
}

export async function resumeRun(
  runId: string,
  approval: Approval,
): Promise<RunOutcome> {
  const run = getRun(runId);
  if (!run) {
    return { run_id: runId, status: "failed", error: { code: "RUN_NOT_FOUND", message: `No run ${runId}` } };
  }
  if (run.status !== "awaiting_approval" || !run.gate) {
    return {
      run_id: runId,
      status: "failed",
      error: { code: "RUN_INVALID_STATE", message: `Run ${runId} is not awaiting approval` },
    };
  }

  const ctx = readContext(run);
  const approved = approval.approved !== false; // default to approved unless explicitly false

  if (!approved) {
    const cancelled: Partial<Run> = {
      status: "failed",
      gate: undefined,
      error: { code: "USER_REJECTED", message: `User rejected ${run.gate.type}` },
      updated_at: nowIso(),
    };
    await updateRun(runId, cancelled);
    return { run_id: runId, status: "failed", error: cancelled.error };
  }

  await applyApproval(run.gate.type, ctx, approval);

  const resumed: Run = {
    ...run,
    status: "running",
    gate: undefined,
    context: ctx,
    updated_at: nowIso(),
  };
  await updateRun(runId, { status: "running", gate: undefined, context: ctx });
  return advance(resumed);
}

async function applyApproval(
  gate: GateType,
  ctx: RunContext,
  approval: Approval,
): Promise<void> {
  if (gate === "create_account" && ctx.login) {
    ctx.login.register = true;
    delete ctx.login.pending_gate;
  } else if (gate === "session_token" && ctx.login) {
    if (approval.session_token) {
      ctx.login.session_token_ref = await putSecret(approval.session_token);
      ctx.login.cookie_name = approval.cookie_name ?? "session";
      ctx.login.strategy = "connected_session";
    }
    delete ctx.login.pending_gate;
  } else if (gate === "purchase_confirm" && ctx.purchase) {
    ctx.purchase.approved = true;
    delete ctx.purchase.pending_gate;
  }
}

// ---- Core loop ----

async function advance(run: Run): Promise<RunOutcome> {
  const plan = run.plan!;
  const brief = plan.brief;
  const ctx = readContext(run);
  let cursor = run.cursor;

  try {
    while (cursor < plan.steps.length) {
      const step = plan.steps[cursor]!;
      const gate = await runStep(step, ctx);
      if (gate) {
        await updateRun(run.run_id, {
          status: "awaiting_approval",
          gate,
          cursor,
          context: ctx,
          updated_at: nowIso(),
        });
        return { run_id: run.run_id, status: "awaiting_approval", gate, brief };
      }
      cursor += 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = { code: "PLAN_FAILED", message };
    await updateRun(run.run_id, { status: "failed", error, context: ctx, updated_at: nowIso() });
    return { run_id: run.run_id, status: "failed", brief, error };
  }

  const result = { ...ctx.discovery, receipt: ctx.receipt, parked: ctx.purchase?.parked };
  await updateRun(run.run_id, {
    status: "completed",
    cursor,
    context: ctx,
    result,
    updated_at: nowIso(),
  });
  return { run_id: run.run_id, status: "completed", result, brief };
}

/** Execute one step. Returns a gate to pause on, or undefined to continue. */
async function runStep(step: PlanStep, ctx: RunContext): Promise<RunGate | undefined> {
  switch (step.capability) {
    case "discover":
      return stepDiscover(step, ctx);
    case "login":
      return stepLogin(step, ctx);
    case "purchase":
      return stepPurchase(step, ctx);
    default:
      return undefined; // unknown capability is a no-op (forward-compatible)
  }
}

async function stepDiscover(step: PlanStep, ctx: RunContext): Promise<undefined> {
  const url = (step.args.url as string) ?? ctx.url;
  const queryText = step.args.query as string | undefined;

  if (url) {
    ctx.url = url;
    ctx.domain = safeDomain(url);
    try {
      const res = await query({ url });
      ctx.discovery = {
        product: res.product,
        options: res.options,
        discovery_method: res.discovery_method,
      };
    } catch {
      // non-fatal; purchase will re-discover the price
    }
  } else if (queryText) {
    const res = await searchQuery({ query: queryText });
    ctx.discovery = {
      query: queryText,
      products: res.products,
      search_metadata: res.search_metadata,
    };
  }
  return undefined;
}

async function stepLogin(step: PlanStep, ctx: RunContext): Promise<RunGate | undefined> {
  // Idempotent: once resolved, do not re-resolve (resume re-enters this step).
  if (ctx.login && !ctx.login.pending_gate) return undefined;
  if (ctx.login?.pending_gate) return undefined; // shouldn't happen while running

  const domain = (step.args.domain as string) ?? ctx.domain;
  if (!domain) return undefined; // nothing to log into

  const resolved = await resolveStrategy({ task: ctx.task, domain });
  ctx.login = {
    strategy: resolved.strategy,
    email: resolved.email,
    identity_id: resolved.identity_id,
    register: false,
  };

  if (resolved.needs_gate === "create_account") {
    ctx.login.pending_gate = "create_account";
    return {
      type: "create_account",
      details: {
        domain,
        email: resolved.email,
        message: `Approve creating a new agent account on ${domain}.`,
      },
    };
  }
  if (resolved.needs_gate === "session_token") {
    ctx.login.pending_gate = "session_token";
    return {
      type: "session_token",
      details: {
        domain,
        message: `You appear to have an account on ${domain}. Provide a session token to log in as you.`,
      },
    };
  }
  return undefined;
}

async function stepPurchase(step: PlanStep, ctx: RunContext): Promise<RunGate | undefined> {
  const url = (step.args.url as string) ?? ctx.url;
  if (!url) throw new Error("purchase step has no URL to buy");
  const selections = step.args.selections as Record<string, string> | undefined;

  // First entry: get a quote and pause for human confirmation.
  if (!ctx.purchase) {
    const order = await buy({ url, selections });
    const breakdown = buildBreakdown(order.payment);
    ctx.purchase = {
      order_id: order.order_id,
      approved: false,
      pending_gate: "purchase_confirm",
      breakdown,
    };
    return {
      type: "purchase_confirm",
      details: {
        order_id: order.order_id,
        product: order.product.name,
        ...breakdown,
      },
    };
  }

  // Resumed and approved: complete checkout with the (just-in-time) login plan.
  if (ctx.purchase.approved) {
    const loginPlan = await buildLoginPlan(ctx);
    // No-spend oversight mode: run the real browser through to the payment page
    // and STOP there. No card is issued; nothing is spent.
    const stopBeforePlaceOrder = process.env.DRY_RUN_NO_SPEND === "1";
    const result = await confirm({
      order_id: ctx.purchase.order_id,
      loginPlan,
      stopBeforePlaceOrder,
    });
    if (result.parked) {
      ctx.purchase.parked = result.parked as unknown as Record<string, unknown>;
    } else {
      ctx.receipt = result.receipt as unknown as Record<string, unknown>;
    }
    return undefined;
  }

  // Awaiting approval still (defensive).
  return ctx.purchase.pending_gate
    ? { type: ctx.purchase.pending_gate, details: ctx.purchase.breakdown ?? {} }
    : undefined;
}

/** Honest price breakdown: item, platform fee, quote total, and the funding ceiling. */
function buildBreakdown(payment: {
  price: string;
  fee: string;
  fee_rate: string;
  total: string;
}): Record<string, unknown> {
  const total = parseFloat(payment.total) || 0;
  const buffered = total * (1 + getAgentcardBufferPct());
  const ceiling = Math.min(buffered, getAgentcardMaxAmount());
  return {
    item_price: payment.price,
    platform_fee: payment.fee,
    fee_rate: payment.fee_rate,
    quote_total: payment.total,
    // The single-use card is funded up to this, to cover tax + shipping at checkout.
    estimated_max_charge: (Math.ceil(ceiling * 100) / 100).toFixed(2),
    note: "Final tax/shipping are computed at checkout; the card is capped at estimated_max_charge.",
  };
}

/**
 * Build the ephemeral LoginPlan from the resolved strategy, fetching secrets
 * from the vault at the last possible moment. Returns undefined for guest/none.
 */
async function buildLoginPlan(ctx: RunContext): Promise<LoginPlan | undefined> {
  const login = ctx.login;
  const domain = ctx.domain;
  if (!login || !domain || login.strategy === "guest") return undefined;

  if (login.strategy === "agent" && login.identity_id) {
    const identity = getAgentIdentity(login.identity_id);
    if (!identity) return undefined;
    const site = await getOrCreateSiteAccount(identity, domain);
    return {
      strategy: "agent",
      email: identity.email,
      password: site.password, // ephemeral; never persisted/logged
      agentInboxId: identity.inbox_id,
      domain,
      register: login.register,
    };
  }

  if (login.strategy === "connected_session" && login.session_token_ref) {
    const token = getSecret(login.session_token_ref); // ephemeral
    const cookies: SessionCookie[] = [
      { name: login.cookie_name ?? "session", value: token, domain },
    ];
    return { strategy: "connected_session", email: login.email, sessionCookies: cookies, domain };
  }

  if (login.strategy === "connected_otp") {
    return { strategy: "connected_otp", email: login.email, domain };
  }

  return undefined;
}
