/**
 * Login-gate execution.
 *
 * Drives a login form once the checkout loop detects a login gate, using a
 * LoginPlan resolved upstream (by @tomo/identity via the planner).
 *
 * SECURITY: the password / session token are SECRETS. They are filled via
 * direct Playwright locators here and never passed to `playwrightAct` (the LLM
 * action path). The model only ever sees the email/username. This is the same
 * trust boundary that protects card numbers (see credentials.ts CDP_FIELDS).
 */
import type { BrowserContext, Page } from "playwright";
import type { LoginStrategy } from "@tomo/core";
import { getComposioClient, extractCode } from "@tomo/identity";
import { scriptedFillVerificationCode, scriptedClickButton } from "./scripted-actions.js";
import { pollForVerificationCode } from "./agentmail.js";

export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
}

export interface LoginPlan {
  strategy: LoginStrategy;
  /** Email/username typed into the form (LLM-safe, not a secret). */
  email: string;
  /** SECRET — direct fill only. Present for agent identities. */
  password?: string;
  /** Cookies to seed for a session-token login (connected_session). */
  sessionCookies?: SessionCookie[];
  /** AgentMail inbox id, for reading agent-identity OTP codes. */
  agentInboxId?: string;
  domain: string;
  /** Whether registering a brand-new account is permitted (post create_account gate). */
  register?: boolean;
}

export interface LoginResult {
  /** True if this module took over the gate (caller should not run guest fallback). */
  handled: boolean;
  /** True if the login form appears to have been submitted/advanced. */
  advanced: boolean;
  note?: string;
}

const SUBMIT_LABELS = [
  "sign in",
  "log in",
  "login",
  "continue",
  "next",
  "submit",
];

const REGISTER_LABELS = [
  "create account",
  "sign up",
  "register",
  "create an account",
];

/** Seed session cookies onto the context before navigation. Best-effort. */
export async function seedSessionCookies(
  context: BrowserContext,
  cookies: SessionCookie[],
): Promise<void> {
  if (!cookies.length) return;
  const normalized = cookies.map((c) => {
    if (c.url) return { name: c.name, value: c.value, url: c.url };
    const domain = c.domain ?? "";
    return {
      name: c.name,
      value: c.value,
      domain: domain.startsWith(".") ? domain : `.${domain}`,
      path: c.path ?? "/",
    };
  });
  try {
    await context.addCookies(normalized);
  } catch {
    // best-effort; a malformed cookie shouldn't abort checkout
  }
}

async function fillBySelectors(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.fill(value, { timeout: 5000 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

const EMAIL_SELECTORS = [
  "input[type=email]",
  "input[name*=email i]",
  "input[id*=email i]",
  "input[autocomplete=username]",
  "input[name*=user i]",
];

const PASSWORD_SELECTORS = [
  "input[type=password]",
  "input[name*=pass i]",
  "input[id*=pass i]",
  "input[autocomplete=current-password]",
  "input[autocomplete=new-password]",
];

async function clickAny(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    if (await scriptedClickButton(page, label)) return true;
  }
  return false;
}

/**
 * Execute the login gate per the resolved plan. Returns handled=false for the
 * "guest"/no-plan case so the caller runs its existing guest-checkout fallback.
 */
export async function executeLogin(
  page: Page,
  context: BrowserContext,
  plan: LoginPlan | undefined,
): Promise<LoginResult> {
  if (!plan || plan.strategy === "guest") {
    return { handled: false, advanced: false };
  }

  switch (plan.strategy) {
    case "connected_session":
      // Cookies were seeded before navigation; just try to move forward.
      return {
        handled: true,
        advanced: await clickAny(page, SUBMIT_LABELS),
        note: "session-cookie login",
      };

    case "connected_otp":
      return loginWithOtp(page, plan, readConnectedOtp);

    case "agent":
      return loginWithAgent(page, plan);

    default:
      return { handled: false, advanced: false };
  }
}

/** Type the email and submit the first step (email-only or email+password). */
async function submitEmail(page: Page, plan: LoginPlan): Promise<boolean> {
  const filledEmail = await fillBySelectors(page, EMAIL_SELECTORS, plan.email);
  // Some forms show password on the same step.
  if (plan.password) {
    await fillBySelectors(page, PASSWORD_SELECTORS, plan.password);
  }
  const labels = plan.register ? [...REGISTER_LABELS, ...SUBMIT_LABELS] : SUBMIT_LABELS;
  const clicked = await clickAny(page, labels);
  return filledEmail || clicked;
}

type OtpReader = (plan: LoginPlan, since: string) => Promise<string | null>;

async function loginWithOtp(
  page: Page,
  plan: LoginPlan,
  readOtp: OtpReader,
): Promise<LoginResult> {
  const since = new Date().toISOString();
  await submitEmail(page, plan);
  await page.waitForTimeout(2000);

  const code = await readOtp(plan, since);
  if (!code) {
    return { handled: true, advanced: false, note: "OTP not received" };
  }
  const filled = await scriptedFillVerificationCode(page, code);
  const advanced = filled && (await clickAny(page, ["verify", ...SUBMIT_LABELS]));
  return { handled: true, advanced, note: "OTP login" };
}

/** Read a one-time code from the user's connected email via Composio. */
async function readConnectedOtp(
  plan: LoginPlan,
  _since: string,
): Promise<string | null> {
  const composio = getComposioClient();
  if (!(await composio.isConnected())) return null;
  try {
    const hits = await composio.searchEmail({
      from: plan.domain,
      query: "code OR verification OR one-time OR passcode",
      newerThanDays: 1,
      limit: 5,
    });
    for (const hit of hits) {
      const msg = await composio.getMessage(hit.id);
      const code = extractCode(`${hit.subject} ${msg?.body ?? hit.snippet}`);
      if (code) return code;
    }
  } catch {
    return null;
  }
  return null;
}

/** Agent identity: fill email + password, submit; handle AgentMail OTP if prompted. */
async function loginWithAgent(
  page: Page,
  plan: LoginPlan,
): Promise<LoginResult> {
  const since = new Date().toISOString();
  const submitted = await submitEmail(page, plan);

  // If the agent inbox is available, opportunistically poll for an OTP step.
  if (plan.agentInboxId) {
    await page.waitForTimeout(2000);
    const code = await pollForVerificationCode(plan.agentInboxId, since, 30_000);
    if (code) {
      const filled = await scriptedFillVerificationCode(page, code);
      if (filled) await clickAny(page, ["verify", ...SUBMIT_LABELS]);
    }
  }

  return {
    handled: true,
    advanced: submitted,
    note: plan.register ? "agent registration" : "agent login",
  };
}
