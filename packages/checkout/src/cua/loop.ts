/**
 * The Computer-Use-Agent loop.
 *
 * A single strong model (Claude via OpenRouter tool-calling) drives the page to
 * accomplish one objective, holding the FULL conversation across the whole task
 * — so it remembers what it already tried (the key upgrade over the old
 * per-page, near-stateless batch loop). Every turn it gets a freshly REDACTED
 * screenshot + the interactive-element list and replies with tool calls, which
 * we execute and feed back as non-secret tool results.
 *
 * SECURITY: secrets never enter the conversation. Screenshots always go through
 * captureRedactedScreenshot; capability tools (login / fill_card / fill_otp)
 * apply secrets server-side and return only a status string. See cua/tools.ts.
 */

import type { Page } from "playwright";
import {
  completeWithTools,
  parseToolArgs,
  type ChatMessage,
  type ContentPart,
  type ToolCompletion,
  type ToolDef,
} from "../llm.js";
import { snapshot, renderElements, pageSignature, advanced, viewportDims, type PageSignature } from "../act.js";
import { captureRedactedScreenshot } from "../redact.js";
import type { CuaTool, ToolContext, CuaStatus, FinishResult } from "./tools.js";
import { runCuaTaskNative } from "./computer-use-loop.js";

export const SYSTEM = `You are a careful, persistent computer-use agent operating a real web browser to accomplish ONE objective for a user. You see the live page as a SCREENSHOT (the source of truth) plus a numbered list of SOME interactive elements, and you act ONLY by calling tools.

Operating rules:
- The screenshot is what's really on screen. Many real controls (custom-styled links/buttons) are NOT in the element list — to click those, give the click tool the CENTER pixel x,y you see. To click a listed element, pass its ref.
- ELEMENTS vs VISION: the numbered element list can be STALE or mis-mapped. If a numbered-ref click keeps failing or lands but does NOT move the page, STOP using that ref — find the same control in the SCREENSHOT and click it by its CENTER x,y pixel coordinates instead. When the element list and the screenshot disagree, TRUST THE SCREENSHOT.
- SHOPPING FLOW: to buy an item, (1) add it to the cart, (2) OPEN the cart, (3) click Checkout/Continue, (4) sign in or create the account (call login), (5) fill shipping (fill_shipping), then stop at payment. Add to Cart usually updates IN PLACE (a cart-count badge or a mini-cart slides in) WITHOUT a full navigation — so a "no major page change" report after Add to Cart does NOT mean it failed. If the screenshot shows the item was added (cart count went up, an "added to cart" panel appeared), do NOT click Add to Cart again — move on to opening the cart and clicking Checkout. Add the item ONCE.
- ALWAYS clear blockers first: if a cookie banner, newsletter/promo modal, or any overlay covers the page, close it (dismiss_popups, or click its × by coordinates) before anything else.
- Some screenshot fields are SOLID BLACK boxes — those are intentionally redacted secret fields (card, personal info), already handled. Never try to "fix" or re-enter them.
- For login, an emailed one-time code, the credit card, or the shipping form, CALL THE CAPABILITY TOOL (login / fill_otp / fill_card / fill_shipping). Never try to type a password, card number, or OTP yourself — you are not given those values.
- For ordinary personal fields, use type with a \`var\` name. For values the objective specifies (a place, date, quantity, search term), use type with \`text\`.
- Only the viewport is shown; if what you need is off-screen, scroll to reveal it, then act.
- Work in small, deliberate steps. After each result, look at the new screenshot and decide the next best action. If something didn't work, try a DIFFERENT control or approach — do not repeat the same failed action.
- When the objective is reached (or you must stop per the instruction), call finish with the right status.`;

export interface CuaParams {
  objective: string;
  tools: CuaTool[];
  toolContext: ToolContext;
  /** Real PII values to redact from screenshots (never placed in the prompt). */
  piiValues?: string[];
  /** Hard cap on tool calls before giving up. */
  maxToolCalls?: number;
  log?: (m: string) => void;
  /** Injectable model call (defaults to OpenRouter tool-calling) — for testing. */
  model?: (
    messages: ChatMessage[],
    tools: ToolDef[],
    options?: { maxTokens?: number },
  ) => Promise<ToolCompletion>;
  /** Injectable observation (defaults to real snapshot+screenshot) — for testing. */
  observe?: (page: Page, piiValues: string[]) => Promise<Observation>;
}

export interface Observation {
  /** Rendered element list + any page note. */
  text: string;
  /** Redacted screenshot data URL, or null (text-only). */
  image: string | null;
  signature: PageSignature;
}

export interface CuaResult {
  status: CuaStatus;
  orderNumber?: string;
  total?: string;
  note?: string;
  toolCalls: number;
  rounds: number;
}

const DEFAULT_MAX_TOOL_CALLS = (() => {
  const n = Number(process.env.AGENT_TOOL_CALLS_MAX);
  // The full create-account → cart → checkout → shipping → payment flow is long;
  // 60 leaves room to recover from a few dead clicks without starving checkout.
  return Number.isFinite(n) && n > 0 ? n : 60;
})();
const STALL_LIMIT = 6; // rounds with no page advance and no finish
const IDLE_LIMIT = 2; // rounds where the model called no tool
const REPEAT_LIMIT = 2; // identical dead action repeats before forced intervention

/**
 * Stable key for repeat-detection. Quantizes click coordinates to a coarse grid
 * so tiny jitter (e.g. 818,438 → 818,439) still counts as the SAME dead action
 * and trips the vision intervention, instead of evading it as a "new" action
 * every round. Ref clicks key on the ref; everything else on the raw args.
 */
function deadActionKey(name: string, argsJson: string): string {
  if (name === "click") {
    try {
      const a = JSON.parse(argsJson) as { x?: number; y?: number; ref?: number };
      if (typeof a.x === "number" && typeof a.y === "number") {
        return `click:xy:${Math.round(a.x / 24)},${Math.round(a.y / 24)}`;
      }
      if (typeof a.ref === "number") return `click:ref:${a.ref}`;
    } catch {
      /* fall through to raw key */
    }
  }
  return `${name}:${argsJson}`;
}

/** Does the page currently expose card/password inputs (→ aggressive redaction)? */
async function hasSensitiveInputs(page: Page): Promise<boolean> {
  try {
    return (await page.evaluate(() => {
      if (document.querySelector('input[type="password"]')) return true;
      const re = /(card.?num|cc.?num|cvv|cvc|security.?code|card.?exp|cardholder)/i;
      for (const el of Array.from(document.querySelectorAll("input"))) {
        const hay = `${el.name} ${el.id} ${el.getAttribute("autocomplete") ?? ""} ${el.placeholder}`;
        if (re.test(hay)) return true;
      }
      return false;
    })) as boolean;
  } catch {
    return false;
  }
}

/** Default observation: tag elements, capture a redacted screenshot, fingerprint the page. */
async function defaultObserve(page: Page, piiValues: string[]): Promise<Observation> {
  // Let an in-flight navigation settle before evaluating, so a just-clicked link
  // (Add to Cart → redirect) gives us the NEW page, not a destroyed context.
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const els = await snapshot(page);
  const aggressive = await hasSensitiveInputs(page);
  const image = await captureRedactedScreenshot(page, { piiValues, aggressive });
  const signature = await pageSignature(page);
  const vp = await viewportDims(page);
  const dims = vp.width > 0 ? `${vp.width}x${vp.height}` : "unknown";
  const text = [
    `Current URL: ${signature.url}`,
    `Screenshot size: ${dims} pixels (give click x,y within these bounds).`,
    "Interactive elements (PARTIAL — the screenshot may show more):",
    els.length ? renderElements(els) : "(none detected — use the screenshot)",
  ].join("\n");
  return { text, image, signature };
}

/**
 * Observe with navigation recovery. A click that triggers a navigation destroys
 * the old execution context; a snapshot mid-flight throws "Execution context was
 * destroyed". Instead of letting that kill the run, wait for the new page to load
 * and observe once more. Site-agnostic.
 */
async function observeResilient(
  observe: (page: Page, piiValues: string[]) => Promise<Observation>,
  page: Page,
  piiValues: string[],
  log: (m: string) => void,
): Promise<Observation> {
  try {
    return await observe(page, piiValues);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/execution context was destroyed|navigat/i.test(msg)) {
      log("cua: observation hit a navigation — waiting for the new page");
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(800);
      return await observe(page, piiValues);
    }
    throw err;
  }
}

/** Build a user turn from an observation: text + (optional) redacted screenshot image. */
function observationMessage(prefix: string, obs: Observation): ChatMessage {
  const text = prefix ? `${prefix}\n\n${obs.text}` : obs.text;
  if (!obs.image) return { role: "user", content: text };
  const content: ContentPart[] = [
    { type: "text", text },
    { type: "image_url", image_url: { url: obs.image } },
  ];
  return { role: "user", content };
}

/**
 * Strip images from every user turn except the most recent, to bound context
 * cost — the model only needs the CURRENT screenshot; prior ones are replaced
 * with a short note. Returns a new array (no mutation).
 */
function pruneOldImages(messages: ChatMessage[]): ChatMessage[] {
  let lastUserIdx = -1;
  messages.forEach((m, i) => { if (m.role === "user") lastUserIdx = i; });
  return messages.map((m, i) => {
    if (m.role !== "user" || i === lastUserIdx || typeof m.content === "string") return m;
    const textPart = m.content.find((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text");
    const text = textPart?.text ?? "";
    return { ...m, content: `${text}\n[earlier screenshot omitted]` };
  });
}

export async function runCuaTask(params: CuaParams): Promise<CuaResult> {
  // Native Anthropic computer-use: better visual reasoning, no DOM-ref confusion.
  // Activated when ANTHROPIC_API_KEY is set and CUA_MODE is not "tool-calling".
  if (process.env.ANTHROPIC_API_KEY && process.env.CUA_MODE !== "tool-calling") {
    return runCuaTaskNative(params);
  }

  const log = params.log ?? (() => {});
  const page = params.toolContext.page;
  const piiValues = params.piiValues ?? [];
  const maxToolCalls = params.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const model = params.model ?? ((m, t, o) => completeWithTools(m, t, o));
  const observe = params.observe ?? defaultObserve;
  const toolDefs = params.tools.map((t) => t.def);
  const byName = new Map(params.tools.map((t) => [t.def.name, t] as const));

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }];
  let prefix = `Objective: ${params.objective}`;

  let toolCalls = 0;
  let rounds = 0;
  let stallRounds = 0;
  let idleRounds = 0;
  // Count consecutive failures of an identical action (same tool + args) so a
  // model that keeps firing one dead action (e.g. clicking the same wrong pixel)
  // is forcibly redirected instead of burning the whole stall budget on it.
  const deadStreak = new Map<string, number>();

  while (toolCalls < maxToolCalls) {
    rounds++;
    const obs = await observeResilient(observe, page, piiValues, log);
    messages.push(observationMessage(prefix, obs));
    prefix = "";

    let completion: ToolCompletion;
    try {
      completion = await model(pruneOldImages(messages), toolDefs, { maxTokens: 1024 });
    } catch (err) {
      log(`cua: model error: ${err instanceof Error ? err.message : String(err)}`);
      return { status: "error", note: "model call failed", toolCalls, rounds };
    }

    // No tool call — nudge once or twice, then give up.
    if (completion.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: completion.text || "" });
      if (++idleRounds >= IDLE_LIMIT) {
        log("cua: model stopped calling tools — ending");
        return { status: "stopped", note: "model issued no tool calls", toolCalls, rounds };
      }
      prefix = "You did not call any tool. Call a tool to act on the page, or call finish.";
      continue;
    }
    idleRounds = 0;

    // Record the assistant turn (with its tool_calls) so the tool results are valid.
    messages.push({
      role: "assistant",
      content: completion.text || "",
      tool_calls: completion.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const sigBefore = obs.signature;
    let finish: FinishResult | undefined;
    let repeatedDead: string | undefined;

    for (const call of completion.toolCalls) {
      toolCalls++;
      const tool = byName.get(call.name);
      if (!tool) {
        messages.push({ role: "tool", tool_call_id: call.id, content: `unknown tool: ${call.name}` });
        continue;
      }
      const args = parseToolArgs(call);
      let result;
      try {
        result = await tool.run(params.toolContext, args);
      } catch (err) {
        result = { text: `${call.name}: error — ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` };
      }
      log(`cua: ${call.name} → ${result.text}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.text });

      // Track repeated dead actions (same tool + target, ok===false). Coordinate
      // clicks are quantized so 1px jitter doesn't read as a fresh action.
      const sig = deadActionKey(call.name, call.arguments);
      if (result.ok === false) {
        const n = (deadStreak.get(sig) ?? 0) + 1;
        deadStreak.set(sig, n);
        if (n >= REPEAT_LIMIT) repeatedDead = sig;
      } else {
        deadStreak.delete(sig);
      }

      if (result.finish) { finish = result.finish; break; }
      if (toolCalls >= maxToolCalls) break;
    }

    if (finish) {
      return { ...finish, toolCalls, rounds };
    }

    // Repeated-dead-action guard: the model keeps firing the same action that
    // doesn't land. Steer it to VISION — a ref that won't move the page is stale
    // or mis-mapped, so the robust recovery is to click the control the model can
    // SEE by its pixel coordinates, not to try yet another ref.
    if (repeatedDead) {
      deadStreak.delete(repeatedDead);
      // Was the dead action a ref-based click? (deadActionKey → "click:ref:N".)
      const wasRefClick = repeatedDead.startsWith("click:ref:");
      prefix = wasRefClick
        ? `You repeated a ref click that keeps failing (${repeatedDead}) — the page did NOT change, so that element ref is stale, mis-mapped, or covered. ` +
          "STOP clicking that ref. Look at the SCREENSHOT (the source of truth), find the control you want, and click it by its CENTER pixel coordinates: pass x,y to the click tool. Aim at the exact center of the word/icon you see."
        : `You repeated an action that keeps failing (${repeatedDead}) — the page did NOT change, so that target is NOT where you think it is. ` +
          "Do NOT issue it again. Re-read the SCREENSHOT and aim at the EXACT center of the visible control (a few pixels off hits the gap and nothing happens), or scroll to reveal it if it is off-screen, then act.";
      continue; // skip stall accrual this round; the corrective gets a fresh look
    }

    // Stall detection: a round that changed nothing on the page.
    const moved = advanced(sigBefore, await pageSignature(page));
    if (moved) stallRounds = 0;
    else if (++stallRounds >= STALL_LIMIT) {
      log(`cua: no progress for ${stallRounds} rounds — ending`);
      return { status: "stopped", note: "no progress", toolCalls, rounds };
    }
  }

  log(`cua: tool-call budget exhausted (${toolCalls}/${maxToolCalls})`);
  return { status: "stopped", note: "tool-call budget exhausted", toolCalls, rounds };
}
