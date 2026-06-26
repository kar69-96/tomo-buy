/**
 * Planning agent — turns a natural-language task into an ordered ExecutionPlan
 * over the capability registry. Uses an LLM when configured, with a
 * deterministic fallback so the planner is robust offline and in tests.
 */
import type { ExecutionPlan, PlanStep, ExecutionBrief } from "@tomo/core";
import { completeJson, getOpenRouterKey } from "@tomo/identity";
import { describeCapabilities } from "./capabilities.js";
import { buildBrief, fallbackBrief } from "./brief.js";

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/i;

/** Tasks that should always terminate in a purchase/booking checkout step. */
const BUY_INTENT_RE = /\b(buy|book|booking|purchase|order|reserve|reservation|checkout|check\s*out|pay for)\b/i;

export function extractUrl(task: string): string | null {
  const m = task.match(URL_RE);
  return m ? m[0].replace(/[.,)]+$/, "") : null;
}

const SYSTEM_PROMPT = `You are a planning agent for browser-automation tasks. Given a task, produce an ordered plan using ONLY these capabilities:

%CAPS%

Return STRICT JSON: {"steps": [{"capability": string, "args": object}]}

Guidance:
- For buying a specific product URL: [discover(url), login(domain), purchase(url)].
- For booking/reserving anything that ends in payment (a reservation, ticket, appointment, registration, subscription): [login(domain), purchase(url)] — "purchase" covers any checkout that spends money, not just physical products.
- For a natural-language shopping request with no URL: [discover(query)] only — a human picks the product before purchase.
- For a multi-retailer product search or price comparison task (no specific URL, user wants options): [search(query)] or [search(query), compare_prices(query)].
- Always insert a "login" step before "purchase" when the site may gate checkout.
- purchase.selections MUST be a FLAT object of string keys to string values (e.g. {"date":"2026-07-15","quantity":"2","tier":"standard"}). Never nest objects or use non-string values.
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

const VALID = new Set(["discover", "login", "purchase", "search", "compare_prices"]);

/** Plan the ordered capability steps (no brief). */
async function planSteps(task: string): Promise<ExecutionPlan> {
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

/**
 * Plan a task: produce the ordered capability steps AND a high-detail execution
 * brief for the downstream execution agent. The two are computed in parallel,
 * then reconciled so the steps that actually drive execution carry the brief's
 * grounded entry URL and flat string selections.
 */
export async function plan(task: string): Promise<ExecutionPlan> {
  const [base, brief] = await Promise.all([
    planSteps(task),
    buildBrief(task).catch(() => fallbackBrief(task)),
  ]);
  const steps = reconcileSteps(base.steps, brief, task);
  return { ...base, steps, brief };
}

/** Keep only flat string→non-empty-string entries (what checkout selections require). */
function flatStringSelections(obj: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!k.trim()) continue;
    if (typeof v === "string" && v.trim()) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

/**
 * Keys that identify WHICH product (pinned already by the entry URL), not WHICH
 * variant to pick on the page. A brief sometimes lists these in `parameters`
 * (e.g. {"product_name":"Dijon Mustard"}); fed to checkout as a "selection" they
 * become a nonsense instruction ("Select exactly these options: product_name:
 * Dijon Mustard") with no matching page control, burning LLM rounds until the
 * product page stalls out. Genuine variant keys (size, color, scent, plan, …)
 * are NOT here and pass through. Site-agnostic — matched on the normalized key.
 */
const NON_VARIANT_KEYS = new Set([
  "product",
  "productname",
  "producttitle",
  "producturl",
  "item",
  "itemname",
  "name",
  "title",
  "sku",
  "id",
  "productid",
  "url",
  "link",
  "brand",
  "store",
  "site",
  "merchant",
  "vendor",
]);

/** Normalize a key for denylist matching: lowercase, strip non-alphanumerics. */
function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A `quantity: "1"` selection is the page default — picking it changes nothing,
 * but ANY non-empty selection forces the product page onto the slow LLM
 * "select these options" path instead of the fast scripted Add-to-Cart. Drop a
 * redundant quantity-of-1 so single-item buys take the scripted path; keep
 * quantity 2+ (a real multi-buy intent). Matched on the normalized key/value.
 */
function isRedundantQuantity(key: string, value: string): boolean {
  return normalizeKey(key) === "quantity" && value.trim() === "1";
}

/**
 * Selections the checkout page handler can act on: flat strings with the
 * product-identity keys removed (those describe the product, not a variant) and
 * a redundant default quantity dropped.
 */
function toCheckoutSelections(
  obj: Record<string, unknown> | undefined,
): Record<string, string> {
  const flat = flatStringSelections(obj);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (NON_VARIANT_KEYS.has(normalizeKey(k))) continue;
    if (isRedundantQuantity(k, v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Reconcile the LLM/fallback steps against the grounded brief. The LLM plan is
 * unreliable — it sometimes drops the purchase step or emits nested, non-string
 * selections that the checkout layer rejects. The brief, by contrast, is grounded
 * and always flat-stringly typed. So we:
 *   1. Prefer the brief's grounded entry URL for discover/purchase steps.
 *   2. Guarantee a purchase step for buy/booking intent (login before it).
 *   3. Drive purchase selections from brief.parameters (always flat strings),
 *      merged over any flat selections the LLM produced.
 */
export function reconcileSteps(
  rawSteps: PlanStep[],
  brief: ExecutionBrief | undefined,
  task: string,
): PlanStep[] {
  const entryUrl = brief?.target?.url?.trim() || extractUrl(task) || undefined;
  const domain = brief?.target?.domain?.trim() || (entryUrl ? safeDomain(entryUrl) : undefined);
  const briefParams = toCheckoutSelections(brief?.parameters);

  const steps: PlanStep[] = rawSteps.map((s) => {
    const args = { ...s.args };
    if ((s.capability === "discover" || s.capability === "purchase") && entryUrl && !args.url) {
      args.url = entryUrl;
    }
    if (s.capability === "purchase") {
      const merged = { ...toCheckoutSelections(args.selections as Record<string, unknown>), ...briefParams };
      if (Object.keys(merged).length > 0) args.selections = merged;
      else delete args.selections;
      return { ...s, args, gate: "purchase_confirm" as const };
    }
    return { ...s, args };
  });

  const wantsPurchase = BUY_INTENT_RE.test(task) || (brief?.objective ? BUY_INTENT_RE.test(brief.objective) : false);
  const hasPurchase = steps.some((s) => s.capability === "purchase");

  // A buy/booking task with a known target but no purchase step is the common
  // LLM failure mode — synthesize the missing step from the grounded brief.
  if (wantsPurchase && !hasPurchase && entryUrl) {
    if (domain && !steps.some((s) => s.capability === "login")) {
      steps.push({ capability: "login", args: { domain } });
    }
    const args: Record<string, unknown> = { url: entryUrl };
    if (Object.keys(briefParams).length > 0) args.selections = briefParams;
    steps.push({ capability: "purchase", args, gate: "purchase_confirm" });
  }

  return steps;
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
