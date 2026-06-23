/**
 * Capability registry — the set of tools the planning agent can compose.
 *
 * The planner LLM is shown this list and picks an efficient ordered plan. The
 * executor (run.ts) implements each capability against existing primitives
 * (discovery, identity/login, purchase). Add a capability here + a handler in
 * run.ts to extend what the agent can do on the web.
 */
export interface Capability {
  name: string;
  description: string;
  inputs: string;
  /** Whether this capability spends money or touches the user's account. */
  sensitive?: boolean;
}

export const CAPABILITIES: Capability[] = [
  {
    name: "discover",
    description:
      "Find a product (name, price, options) from a product URL, or search the web for one from a natural-language query.",
    inputs: "url (string) OR query (string)",
  },
  {
    name: "login",
    description:
      "Get past a login gate on a service. Decides between the user's connected account (when the task needs the user's own account, e.g. airlines, existing orders) and a fresh agent identity (generic shops).",
    inputs: "domain (string, inferred from the target URL)",
  },
  {
    name: "purchase",
    description:
      "Buy a product at a URL: get a quote (price + shipping + tax + fee), confirm with the human, then complete checkout funded by a single-use card. Spends real money.",
    inputs: "url (string), selections (object, optional)",
    sensitive: true,
  },
];

export function describeCapabilities(): string {
  return CAPABILITIES.map(
    (c) =>
      `- ${c.name}: ${c.description} (inputs: ${c.inputs})${c.sensitive ? " [SENSITIVE]" : ""}`,
  ).join("\n");
}
