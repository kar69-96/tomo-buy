/**
 * Structured-output contract for a Browserbase Agents checkout run.
 *
 * The agent is instructed to drive to the payment page and PARK — it never enters
 * card details or places the order (that step is completed locally over CDP, since
 * card secrets must never reach Browserbase). So there is deliberately no
 * `order_number`: the run's job is to reach payment and report the observed total.
 *
 * `AGENT_RESULT_SCHEMA` is the JSON Schema sent to Browserbase; `AgentResultSchema`
 * is the Zod schema used to validate the returned `result` at our boundary.
 */

import { z } from "zod";

export const AGENT_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["reached_payment", "blocked", "failed"],
      description:
        "reached_payment = item(s) in cart, shipping entered, and the payment page (asking for a card number) is displayed; blocked = a wall (login, captcha, out-of-stock, region) stopped progress; failed = could not proceed for another reason.",
    },
    observed_total: {
      type: "string",
      description:
        'The order total shown on the payment page, including currency symbol (e.g. "$18.42"). Empty string if payment was not reached.',
    },
    order_summary: {
      type: "string",
      description:
        "A short human-readable summary of what is in the cart and the current page state.",
    },
    blocked_reason: {
      type: "string",
      description:
        "When status is blocked or failed, a concise explanation of what stopped progress.",
    },
  },
  required: ["status", "observed_total", "order_summary"],
  additionalProperties: false,
};

export const AgentResultSchema = z.object({
  status: z.enum(["reached_payment", "blocked", "failed"]),
  observed_total: z.string(),
  order_summary: z.string(),
  blocked_reason: z.string().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;
