/**
 * Execution brief — turns a natural-language task into a high-detail, structured
 * brief for the headless execution agent. It grounds the task against live data
 * (Exa search / URL discovery) to resolve the real site + entry URL, then asks
 * the LLM to synthesize a concrete brief: objective, target, login type,
 * structured parameters, constraints, ordered execution steps, and the facts the
 * executor must resolve live (e.g. a specific available option) rather than invent.
 *
 * SECURITY: the brief carries only task intent + public/grounded facts. It NEVER
 * contains a card number, password, or session token — those stay in the
 * funding/vault paths and reach checkout out-of-band (see CLAUDE.md prime directive).
 */
import type {
  ExecutionBrief,
  BriefCandidate,
  BriefLoginType,
  BriefFlow,
  SearchQueryResponse,
  QueryResponse,
} from "@tomo/core";
import { completeJson, getOpenRouterKey } from "@tomo/identity";
import { searchQuery, query } from "@tomo/orchestrator";
import { extractUrl } from "./plan.js";

const LOGIN_TYPES: readonly BriefLoginType[] = [
  "email_otp",
  "password",
  "session",
  "agent",
  "none",
  "unknown",
];

const MAX_CANDIDATES = 5;

const SYSTEM_PROMPT = `You are a planning agent that writes a precise, high-detail execution brief for a separate headless browser agent that will carry out a task on the web. The executor is literal and benefits from concrete, unambiguous instructions.

You are given the user's task, today's date (to resolve relative dates like "tomorrow"), and GROUNDED candidates discovered live from the web (real site names + URLs). Prefer a grounded URL over guessing one.

Return STRICT JSON with exactly this shape:
{
  "objective": string,          // one-line restatement of the resolved goal
  "site": string,               // human-readable service/store name, e.g. "Acme Tickets"
  "url": string,                // best entry URL (prefer a grounded candidate; "" if unknown)
  "domain": string,             // bare hostname, e.g. "example.com" ("" if unknown)
  "flow": "product"|"form_flow",// how the executor drives this task (see Flow below)
  "login": { "required": boolean, "type": "email_otp"|"password"|"session"|"agent"|"none"|"unknown", "notes": string },
  "parameters": object,         // domain-specific structured params, string values (origin, destination, date, time_window, fare_type, size, color, ...)
  "constraints": string[],      // hard requirements/preferences (e.g. a budget cap, a preferred time/option, a tier/class)
  "execution_steps": string[],  // ordered, concrete steps for the headless agent
  "resolve_live": string[]      // facts that can ONLY be known at run time (a specific available option, an exact time slot, current live availability). Never invent these.
}

Flow (pick exactly one):
- "product": a concrete physical/digital item bought via an Add-to-Cart / Buy-Now button, then a checkout (e.g. a Shopify product page, a specific item URL).
- "form_flow": a multi-step, form-driven task with NO add-to-cart — the user fills a search/booking form, picks from live results, then proceeds to payment. ALL travel (flights, hotels, car rental), reservations, appointments, event tickets chosen from a seat/date map, and registrations are "form_flow". When in doubt for anything bookable/schedulable, choose "form_flow".

Rules:
- Resolve relative dates to absolute ISO dates using today's date.
- Put anything you cannot know for certain at plan time (a specific available option, a live price, current availability) in resolve_live as an instruction — do NOT fabricate it.
- Never include passwords, card numbers, or session tokens.
- Keep execution_steps concrete and ordered; assume the executor sees the page but needs to be told what to choose. For a form_flow, the FIRST steps must fully specify how to complete the search/booking form (set trip/option type, fill each field and pick the matching suggestion, set the date in the date picker, set quantities/passengers) and then submit it to reach the results.`;

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val == null) continue;
    out[k] = typeof val === "string" ? val : String(val);
  }
  return out;
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

function isHomepage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === "/" || pathname === "";
  } catch {
    return false;
  }
}

interface Grounding {
  /** "exa+discovery" | "url-fetch" | "llm-only". */
  method: string;
  candidates: BriefCandidate[];
  /** Best entry URL found, if any. */
  url?: string;
  /** Site/product name, if any. */
  name?: string;
}

/** Resolve real-world facts for the task: the site, entry URL, and candidates. */
async function ground(task: string): Promise<Grounding> {
  const url = extractUrl(task);
  if (url) {
    try {
      const res = (await query({ url })) as QueryResponse;
      const p = res.product;
      return {
        method: "url-fetch",
        url,
        name: p?.name,
        candidates: p ? [{ name: p.name, url: p.url, price: p.price }] : [],
      };
    } catch {
      return { method: "url-fetch", url, candidates: [] };
    }
  }

  try {
    const res = (await searchQuery({ query: task })) as SearchQueryResponse;
    const candidates: BriefCandidate[] = (res.products ?? [])
      .slice(0, MAX_CANDIDATES)
      .map((p) => ({ name: p.product.name, url: p.product.url, price: p.product.price }));
    return {
      method: "exa+discovery",
      url: candidates[0]?.url,
      name: candidates[0]?.name,
      candidates,
    };
  } catch {
    return { method: "llm-only", candidates: [] };
  }
}

interface RawBrief {
  objective?: unknown;
  site?: unknown;
  url?: unknown;
  domain?: unknown;
  flow?: unknown;
  login?: { required?: unknown; type?: unknown; notes?: unknown };
  parameters?: unknown;
  constraints?: unknown;
  execution_steps?: unknown;
  resolve_live?: unknown;
}

/** Keywords that mean "this is a multi-step form flow, not an add-to-cart". */
const FORM_FLOW_RE =
  /\b(book|booking|flight|fly|airfare|hotel|stay|room|rental|rent a car|reserve|reservation|appointment|schedule|registration|register|ticket|seat|itinerary|check\s*in)\b/i;

/** Resolve the executor flow: explicit planner choice, else a task-intent heuristic. */
function resolveFlow(raw: unknown, task: string, objective: string): BriefFlow {
  if (raw === "form_flow" || raw === "product") return raw;
  return FORM_FLOW_RE.test(task) || FORM_FLOW_RE.test(objective) ? "form_flow" : "product";
}

function normalize(r: RawBrief, g: Grounding, task: string): ExecutionBrief {
  const llmUrl = strOr(r.url, "");
  // When the task contained an explicit URL, grounding fetched that exact product page
  // and g.url is authoritative — don't let the LLM override it with a browse/category URL.
  // For Exa-search runs (no task URL), prefer the LLM's URL only if it's a specific
  // product page (not a homepage), else fall back to Exa's top candidate.
  const url =
    g.method === "url-fetch"
      ? strOr(g.url ?? "", llmUrl)
      : llmUrl && !isHomepage(llmUrl)
        ? llmUrl
        : strOr(g.url ?? "", "");
  const domain = strOr(r.domain, url ? safeDomain(url) : "");
  const rawType = r.login?.type;
  const type: BriefLoginType = LOGIN_TYPES.includes(rawType as BriefLoginType)
    ? (rawType as BriefLoginType)
    : "unknown";
  const notes = typeof r.login?.notes === "string" ? r.login.notes : undefined;
  const objective = strOr(r.objective, "");
  return {
    objective,
    target: { site: strOr(r.site, g.name ?? domain), url, domain },
    flow: resolveFlow(r.flow, task, objective),
    login: { required: Boolean(r.login?.required), type, ...(notes ? { notes } : {}) },
    parameters: asStringMap(r.parameters),
    constraints: asStringArray(r.constraints),
    execution_steps: asStringArray(r.execution_steps),
    resolve_live: asStringArray(r.resolve_live),
    grounding: { method: g.method, candidates: g.candidates },
  };
}

function defaultSteps(url: string): string[] {
  return url
    ? [`Navigate to ${url}`, "Complete the task on the page", "Stop before any irreversible action for human confirmation"]
    : ["Identify the target site for the task", "Navigate and complete the task", "Stop before any irreversible action for human confirmation"];
}

/** Deterministic brief used when the LLM is unavailable or fails. */
export function fallbackBrief(task: string, g?: Grounding): ExecutionBrief {
  const url = g?.url ?? extractUrl(task) ?? "";
  const domain = url ? safeDomain(url) : "";
  return {
    objective: task,
    target: { site: g?.name ?? domain, url, domain },
    flow: resolveFlow(undefined, task, task),
    login: { required: Boolean(domain), type: "unknown" },
    parameters: {},
    constraints: [],
    execution_steps: defaultSteps(url),
    resolve_live: url ? [] : ["target site / booking URL"],
    grounding: { method: "fallback", candidates: g?.candidates ?? [] },
  };
}

function userMessage(task: string, g: Grounding): string {
  const today = new Date().toISOString().slice(0, 10);
  const candidates = g.candidates.length
    ? g.candidates
        .map((c, i) => `  ${i + 1}. ${c.name} — ${c.url}${c.price ? ` (${c.price})` : ""}`)
        .join("\n")
    : "  (none found)";
  return `Today: ${today}\nTask: ${task}\n\nGrounded candidates (from live web search):\n${candidates}`;
}

/**
 * Build a high-detail execution brief for a task. Grounds against live data,
 * then synthesizes with the LLM. Always resolves (never throws): degrades to a
 * deterministic fallback brief when the LLM is unavailable or errors.
 */
export async function buildBrief(task: string): Promise<ExecutionBrief> {
  if (!getOpenRouterKey()) return fallbackBrief(task);

  const g = await ground(task);
  try {
    const raw = await completeJson<RawBrief>(SYSTEM_PROMPT, userMessage(task, g), {
      temperature: 0,
      maxTokens: 900,
    });
    if (!raw) return fallbackBrief(task, g);
    return normalize(raw, g, task);
  } catch {
    return fallbackBrief(task, g);
  }
}
