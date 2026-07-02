/**
 * Build the natural-language `task` + `%variables%` for a Browserbase Agents
 * checkout run from a CheckoutInput.
 *
 * PRIME DIRECTIVE (structural): only NON-secret fields become variables. We reuse
 * the exact same credential split the local engine uses (getStagehandVariables),
 * which drops every CDP-only field (card PAN/CVV/expiry, login password, session
 * token). The login EMAIL is LLM-safe and is passed; the password never is.
 * assertNoCdpSecrets() is a belt-and-suspenders guard that THROWS if any secret
 * ever slips into the variable map — so a coding mistake fails loudly rather than
 * silently leaking a secret to Browserbase's cloud.
 */

import {
  buildCredentials,
  getStagehandVariables,
  isCdpField,
} from "../credentials.js";
import type { AgentVariable } from "./client.js";
import type { CheckoutInput } from "../task.js";

export interface AgentTaskSpec {
  task: string;
  variables: Record<string, AgentVariable>;
}

/**
 * Refuse to send any CDP-only secret (card fields, login password, session token)
 * to Browserbase. Throws by construction — the invariant is not optional.
 */
export function assertNoCdpSecrets(
  variables: Record<string, AgentVariable>,
): void {
  for (const key of Object.keys(variables)) {
    if (isCdpField(key)) {
      throw new Error(
        `Prime Directive violation: CDP-only secret "${key}" must never be sent to Browserbase`,
      );
    }
  }
}

/** Turn a credential key like "x_shipping_zip" into "shipping zip" for a hint. */
function humanize(key: string): string {
  return key.replace(/^x_/, "").replace(/_/g, " ");
}

function buildTaskPrompt(
  input: CheckoutInput,
  variables: Record<string, AgentVariable>,
): string {
  const { order } = input;
  const varList = Object.keys(variables)
    .map((k) => `%${k}%`)
    .join(", ");

  const selections = input.selections ?? order.selections ?? {};
  const selLine = Object.keys(selections).length
    ? `Select these product options: ${Object.entries(selections)
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ")}.`
    : "";

  const loginLine = input.loginPlan?.email
    ? "If the site requires signing in to check out, sign in using the email %x_login_email% — the password is entered for you out-of-band, so do NOT ask for, invent, or type a password. Do not let sign-in block the task; if it isn't readily available, continue as a guest."
    : "Check out as a guest. Do not create an account or sign in unless the page blocks all further progress without it.";

  return [
    "Purchase task — drive a real e-commerce checkout up to (but NOT including) payment.",
    `1. Open this product page: ${order.product.url}`,
    selLine,
    "2. Add the item to the cart and proceed to checkout.",
    loginLine,
    `3. Enter the shipping/contact details using these placeholder variables (their real values are filled in for you — never invent or guess values): ${varList}.`,
    "4. Advance to the PAYMENT page — the page that asks for a credit-card number.",
    "HARD STOP THERE. Do NOT enter any card, billing-card, or payment details. Do NOT place, confirm, submit, or 'buy' the order. Entering payment information or completing the purchase is strictly forbidden — the payment step is handled separately.",
    'When you reach the payment page, report the displayed order total as observed_total and set status to "reached_payment". If a login wall, captcha, out-of-stock, or region restriction stops you, set status to "blocked" and explain in blocked_reason.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAgentTask(input: CheckoutInput): AgentTaskSpec {
  // Same credential split as the local engine: non-secret %vars% only. The card
  // (when present) is dropped here — it never reaches the variable map.
  const creds = buildCredentials(input.shipping, input.card);
  const nonSecret = getStagehandVariables(creds);

  const variables: Record<string, AgentVariable> = {};
  for (const [key, value] of Object.entries(nonSecret)) {
    if (value) variables[key] = { value, description: humanize(key) };
  }

  // Login email is LLM-safe (never the password/token).
  if (input.loginPlan?.email) {
    variables.x_login_email = {
      value: input.loginPlan.email,
      description: "Account email/username for sign-in",
    };
  }

  // Fail loudly if any secret ever slipped through.
  assertNoCdpSecrets(variables);

  const task = buildTaskPrompt(input, variables);
  return { task, variables };
}
