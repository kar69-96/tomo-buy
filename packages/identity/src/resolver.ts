/**
 * Identity strategy resolver.
 *
 * Decides how to get past a login gate on a given service. An LLM makes the
 * call from a system prompt: if the task needs the USER's existing account on
 * the service, log in via the user's connected account (OTP read from their
 * email, or a session token); otherwise use an AGENT identity.
 *
 * Evidence that the user has an account comes from searching their connected
 * email via Composio (signup confirmations, receipts). With Composio stubbed,
 * there is no evidence and we default to an agent identity.
 */
import type { LoginStrategy, GateType } from "@tomo/core";
import { getConnectedAccounts, getSiteAccount } from "@tomo/core";
import { getComposioClient } from "./composio.js";
import type { EmailHit } from "./composio.js";
import { getOrCreateAgentIdentity } from "./agent-identity.js";
import { completeJson, getOpenRouterKey } from "./llm.js";

export interface ResolvedLogin {
  strategy: LoginStrategy;
  /** Email/username to type into the login form (LLM-safe; not a secret). */
  email: string;
  /** Agent identity backing an `agent` strategy. */
  identity_id?: string;
  domain: string;
  /** Human approval required before this login can proceed. */
  needs_gate?: GateType;
  /** Diagnostic note (logged, not shown to the model). */
  note?: string;
}

interface ResolverInput {
  task: string;
  domain: string;
}

interface LlmDecision {
  needs_user_account: boolean;
  preferred_method?: "otp" | "session";
  reason?: string;
}

/**
 * Detect an explicit request to check out as a guest (no login, no account).
 * When present, the resolver short-circuits to the `guest` strategy with no gate.
 */
export function wantsGuest(task: string): boolean {
  return /\bas a guest\b|\bas guest\b|\bguest checkout\b|\bwithout (an )?account\b|\bwithout (logging|signing) in\b|\bdo(n'?t| not) (log|sign) in\b/i.test(
    task,
  );
}

/** Normalize a URL or host into a bare registrable-ish hostname. */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    // not a URL; treat as host
  }
  return host.replace(/^www\./, "");
}

const SYSTEM_PROMPT = `You route browser-automation logins. Decide whether a task requires the USER's OWN existing account on a specific service, or whether a fresh throwaway "agent" account is fine.

Return STRICT JSON: {"needs_user_account": boolean, "preferred_method": "otp"|"session", "reason": string}

Rules:
- needs_user_account = true when the task is tied to the user's personal records on that service: airline check-in, existing orders/subscriptions, banking, loyalty/wallet, account settings, anything referencing "my" booking/order/account.
- needs_user_account = false for generic shopping/checkout on a store where any account (or guest) works.
- preferred_method: "otp" if the user's email is connected (codes can be read automatically); otherwise "session".
- Use the provided inbox evidence: hits from the service domain strongly imply the user already has an account there.`;

function buildUserPrompt(
  input: ResolverInput,
  evidence: EmailHit[],
  emailConnected: boolean,
): string {
  const evidenceLines =
    evidence.length > 0
      ? evidence
          .slice(0, 5)
          .map((h) => `- from ${h.from}: ${h.subject}`)
          .join("\n")
      : "(none found)";
  return [
    `Task: ${input.task}`,
    `Service domain: ${input.domain}`,
    `User email connected: ${emailConnected ? "yes" : "no"}`,
    `Inbox evidence of an existing account on this service:`,
    evidenceLines,
  ].join("\n");
}

/**
 * Resolve the login strategy for a task + domain. Does not read or write any
 * secret — the login executor provisions the agent password at fill time.
 */
export async function resolveStrategy(
  input: ResolverInput,
): Promise<ResolvedLogin> {
  const domain = normalizeDomain(input.domain);

  // Explicit guest request → no login, no account, no gate.
  if (wantsGuest(input.task)) {
    return {
      strategy: "guest",
      email: "",
      domain,
      note: "task requested guest checkout",
    };
  }

  const composio = getComposioClient();
  const emailConnected = await composio.isConnected();

  let evidence: EmailHit[] = [];
  if (emailConnected) {
    try {
      evidence = await composio.searchEmail({
        from: domain,
        query: "account OR order OR confirm OR receipt",
        newerThanDays: 3650,
        limit: 5,
      });
    } catch {
      evidence = [];
    }
  }

  const decision = await decide(input, domain, evidence, emailConnected);

  if (decision.needs_user_account) {
    return resolveConnected(domain, decision, emailConnected);
  }
  return resolveAgent(domain, input.task);
}

async function decide(
  input: ResolverInput,
  domain: string,
  evidence: EmailHit[],
  emailConnected: boolean,
): Promise<LlmDecision> {
  // No LLM key, or any failure → safe default: agent identity.
  if (!getOpenRouterKey()) {
    return { needs_user_account: false, reason: "no LLM key; default agent" };
  }
  try {
    const decision = await completeJson<LlmDecision>(
      SYSTEM_PROMPT,
      buildUserPrompt(input, evidence, emailConnected),
      { temperature: 0, maxTokens: 200 },
    );
    if (decision && typeof decision.needs_user_account === "boolean") {
      return decision;
    }
  } catch {
    // fall through
  }
  return { needs_user_account: false, reason: "resolver fallback; default agent" };
}

function resolveConnected(
  domain: string,
  decision: LlmDecision,
  emailConnected: boolean,
): ResolvedLogin {
  const account = getConnectedAccounts().find(
    (a) => a.status === "connected" && (a.domains?.includes(domain) ?? true),
  );
  const email = account?.email ?? "";

  // OTP is only viable when the user's email is actually connected.
  if (emailConnected && decision.preferred_method === "otp") {
    return {
      strategy: "connected_otp",
      email,
      domain,
      note: decision.reason,
    };
  }
  // Otherwise we need a session token from the user.
  return {
    strategy: "connected_session",
    email,
    domain,
    needs_gate: "session_token",
    note: decision.reason ?? "user account required; awaiting session token",
  };
}

async function resolveAgent(
  domain: string,
  _task: string,
): Promise<ResolvedLogin> {
  const identity = await getOrCreateAgentIdentity();
  const hasAccount = Boolean(getSiteAccount(identity.identity_id, domain));
  return {
    strategy: "agent",
    email: identity.email,
    identity_id: identity.identity_id,
    domain,
    // First time on this site → registering a new account needs permission.
    needs_gate: hasAccount ? undefined : "create_account",
    note: hasAccount ? "existing agent account" : "new agent account",
  };
}
