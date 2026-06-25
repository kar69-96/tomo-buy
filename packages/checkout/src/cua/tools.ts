/**
 * CUA tool registry — the "reference of internal tools" the computer-use agent
 * calls to drive the page. Two kinds:
 *
 *   • Browser tools (click / type / select / scroll / press / dismiss_popups) —
 *     thin, deterministic wrappers over the raw-Playwright primitives in act.ts.
 *   • Capability tools (login / fill_otp / fill_card / fill_shipping / read_total
 *     / finish) — execute server-side and are the ONLY path that touches secrets.
 *
 * SECURITY (prime directive): a card number, password, session token, or OTP
 * code never appears in a tool's arguments OR its result. The model invokes a
 * capability tool by name with non-secret args (e.g. a domain) and receives a
 * non-secret status string. Card/login secrets flow through CDP / direct
 * Playwright inside these executors, never the model context. `isCdpField`
 * (credentials.ts) guards the `type` tool against ever typing a secret %var%.
 */

import type { BrowserContext, Page } from "playwright";
import { getComposioClient, extractCode } from "@tomo/identity";
import type { ToolDef } from "../llm.js";
import {
  visionClick,
  clickRef,
  typeRef,
  selectRef,
  scrollPage,
  pressKey,
  pageSignature,
  advanced,
} from "../act.js";
import {
  scriptedDismissPopups,
  scriptedFillShipping,
  scriptedFillVerificationCode,
  scriptedClickButton,
  extractVisibleTotal,
} from "../scripted-actions.js";
import { scanAllFramesForCardFields } from "../fill.js";
import { executeLogin } from "../login.js";
import type { LoginPlan } from "../login.js";
import { pollForVerificationCode } from "../agentmail.js";
import { isCdpField } from "../credentials.js";

/** Shipping fields for the fill_shipping tool (mirrors scripted-actions' shape). */
export interface ShippingData {
  email: string;
  firstName: string;
  lastName: string;
  street: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
}

/** Terminal status the agent reports via the `finish` tool. */
export type CuaStatus =
  | "confirmation"
  | "parked_payment"
  | "parked_login"
  | "error"
  | "stopped";

export interface FinishResult {
  status: CuaStatus;
  orderNumber?: string;
  total?: string;
  note?: string;
}

/** Everything a tool executor may need. Secrets live here but never leave via results. */
export interface ToolContext {
  page: Page;
  context: BrowserContext;
  /** %var% NAMES → values for PII fills (never a card/password/token value). */
  variables: Record<string, string>;
  /** CDP-only card credentials, filled via fill.ts — never sent to the model. */
  cdpCreds: Record<string, string>;
  shippingData: ShippingData;
  loginPlan?: LoginPlan;
  agentInboxId?: string | null;
  domain: string;
  /** No-spend oversight: card fill is refused and the agent parks at payment. */
  dryRun?: boolean;
  log: (m: string) => void;
}

export interface ToolResult {
  /** Secret-safe summary fed back to the model as the tool result. */
  text: string;
  /** Set ONLY by the `finish` tool — ends the agent loop. */
  finish?: FinishResult;
  /**
   * Whether the action made progress. false means it didn't land / didn't move
   * the page — the loop uses this to detect a model repeating a dead action.
   * undefined for tools where "progress" isn't meaningful (read_total, finish).
   */
  ok?: boolean;
}

export interface CuaTool {
  def: ToolDef;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

// ---- helpers ----

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Run a click and report whether the page meaningfully advanced (model feedback). */
async function reportAdvance(
  ctx: ToolContext,
  label: string,
  act: () => Promise<boolean>,
): Promise<ToolResult> {
  const before = await pageSignature(ctx.page);
  const landed = await act();
  await ctx.page.waitForTimeout(600);
  const moved = advanced(before, await pageSignature(ctx.page));
  // For a ref click that won't take, point the model at vision: the ref is likely
  // stale/mis-mapped, so the recovery is to click the visible control by x,y.
  const isRefClick = label.startsWith("click #");
  const reaim = isRefClick
    ? "click the control by its CENTER x,y pixel coordinates from the screenshot instead — trust the screenshot over the element list"
    : "re-aim at the exact center of the control you see, or try another control";
  if (!landed) return { ok: false, text: `${label}: did not land (target not found/covered/off-screen). ${capitalize(reaim)}.` };
  if (moved) return { ok: true, text: `${label}: done — the page advanced.` };
  // Landed but no MAJOR page change. Many real actions (Add to Cart, toggles,
  // quantity changes) update IN PLACE without tripping our page-advance signal —
  // so defer to the model's vision: if the screenshot shows it already worked,
  // move on; only treat it as a dead action (ok:false → repeat guard) otherwise.
  return {
    ok: false,
    text: `${label}: the click registered but I saw no major page change. If the SCREENSHOT shows it already took effect (item added to cart, a count/panel/section updated, a field toggled), do NOT repeat it — go to the NEXT step (e.g. open the cart and click Checkout). If nothing changed, ${reaim}.`,
  };
}

// ---- browser tools ----

const clickTool: CuaTool = {
  def: {
    name: "click",
    description:
      "Click a control. Prefer a numbered element ref from the element list. If the control is visible in the screenshot but NOT in the list (a custom-styled link/button, a modal ×), give the CENTER pixel coordinates x,y instead — overlay-covered controls are handled for you.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "number", description: "Element ref from the list." },
        x: { type: "number", description: "Center x pixel (when not using ref)." },
        y: { type: "number", description: "Center y pixel (when not using ref)." },
      },
    },
  },
  async run(ctx, args) {
    const x = num(args.x);
    const y = num(args.y);
    const ref = num(args.ref);
    if (x !== undefined && y !== undefined) {
      return reportAdvance(ctx, `click (${x},${y})`, () => visionClick(ctx.page, x, y, ctx.log));
    }
    if (ref !== undefined) {
      return reportAdvance(ctx, `click #${ref}`, () => clickRef(ctx.page, ref, ctx.log));
    }
    return {
      ok: false,
      text: "click: you gave no target. Pass a `ref` from the element list, OR `x` and `y` pixel coordinates (the CENTER of the control you see in the screenshot — e.g. the Checkout button).",
    };
  },
};

const typeTool: CuaTool = {
  def: {
    name: "type",
    description:
      "Type into the input at `ref`. For a personal field (name/email/address/phone) pass `var` with one of the available variable names — the real value is filled for you. For a non-personal value the task specifies (a place, date, quantity, search term) pass `text`. Never type a card number, password, or one-time code with this tool.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "number", description: "Input element ref." },
        var: { type: "string", description: "Variable name for a personal value." },
        text: { type: "string", description: "Literal non-personal value." },
      },
      required: ["ref"],
    },
  },
  async run(ctx, args) {
    const ref = num(args.ref);
    if (ref === undefined) return { text: "type: a ref is required." };
    const varName = str(args.var);
    if (varName) {
      if (isCdpField(varName)) {
        return { text: `type: "${varName}" is a protected secret field — use fill_card / login instead. Skipped.` };
      }
      const value = ctx.variables[varName];
      if (!value) return { text: `type: no value for variable "${varName}".` };
      const ok = await typeRef(ctx.page, ref, value, true, ctx.log);
      return { ok, text: ok ? `type: filled ${varName} into #${ref}.` : `type: could not fill #${ref}.` };
    }
    const text = str(args.text) ?? "";
    if (!text) return { text: "type: provide a `var` (personal) or `text` (literal) value." };
    const ok = await typeRef(ctx.page, ref, text, true, ctx.log);
    return { ok, text: ok ? `type: entered text into #${ref}.` : `type: could not fill #${ref}.` };
  },
};

const selectTool: CuaTool = {
  def: {
    name: "select",
    description: "Choose an option in a <select> dropdown at `ref` by its visible label.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "number" },
        value: { type: "string", description: "Option label to choose." },
      },
      required: ["ref", "value"],
    },
  },
  async run(ctx, args) {
    const ref = num(args.ref);
    const value = str(args.value) ?? "";
    if (ref === undefined) return { text: "select: a ref is required." };
    const ok = await selectRef(ctx.page, ref, value, ctx.log);
    return { ok, text: ok ? `select: chose "${value}" in #${ref}.` : `select: could not choose "${value}" in #${ref}.` };
  },
};

const scrollTool: CuaTool = {
  def: {
    name: "scroll",
    description: "Scroll the viewport to reveal off-screen content. direction: down|up|top|bottom.",
    parameters: {
      type: "object",
      properties: { direction: { type: "string", enum: ["down", "up", "top", "bottom"] } },
    },
  },
  async run(ctx, args) {
    const dir = str(args.direction) ?? "down";
    await scrollPage(ctx.page, dir, undefined, ctx.log);
    return { text: `scroll: ${dir}.` };
  },
};

const pressTool: CuaTool = {
  def: {
    name: "press",
    description: "Press a keyboard key to submit a focused field, move focus, or dismiss an overlay. key: Enter|Tab|Escape|ArrowDown|…",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  async run(ctx, args) {
    const key = str(args.key) ?? "";
    const ok = await pressKey(ctx.page, key, ctx.log);
    return { text: ok ? `press: ${key}.` : "press: provide a key name." };
  },
};

const dismissPopupsTool: CuaTool = {
  def: {
    name: "dismiss_popups",
    description: "Close any cookie banner, newsletter/promo modal, or overlay blocking the page (clicks its ×/close/no-thanks and presses Escape).",
    parameters: { type: "object", properties: {} },
  },
  async run(ctx) {
    const closed = await scriptedDismissPopups(ctx.page);
    try { await ctx.page.keyboard.press("Escape"); } catch { /* best-effort */ }
    return { text: closed.length ? `dismiss_popups: closed ${closed.length} overlay(s).` : "dismiss_popups: nothing to close (or use a click on the × you see)." };
  },
};

// ---- capability tools ----

const loginTool: CuaTool = {
  def: {
    name: "login",
    description:
      "Sign in OR create an account using the pre-resolved identity for this task. The email, password, and any 2FA are handled for you — you never type them. Call this when a sign-in or create-account/sign-up form is on screen (open it first if needed). When account creation is required it registers a new account with the identity's email and a fresh password. Returns whether it advanced.",
    parameters: {
      type: "object",
      properties: { domain: { type: "string", description: "Optional site domain." } },
    },
  },
  async run(ctx) {
    if (!ctx.loginPlan || ctx.loginPlan.strategy === "guest") {
      return { text: "login: no account is configured for this task — continue as guest." };
    }
    try {
      const r = await executeLogin(ctx.page, ctx.context, ctx.loginPlan);
      return { text: `login: ${r.advanced ? "advanced" : "did not complete"} (${r.note ?? ctx.loginPlan.strategy}).` };
    } catch (err) {
      return { text: `login: error — ${err instanceof Error ? err.message.slice(0, 120) : String(err)}.` };
    }
  },
};

/** Read the latest emailed one-time code and fill it — the code never reaches the model. */
const fillOtpTool: CuaTool = {
  def: {
    name: "fill_otp",
    description:
      "When the page asks for an emailed verification / one-time code, call this to fetch the latest code from the connected mailbox and fill it for you. The code itself is never shown to you. Returns whether a code was filled.",
    parameters: { type: "object", properties: {} },
  },
  async run(ctx) {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    let code: string | null = null;

    // Agent identity inbox (AgentMail).
    if (ctx.agentInboxId) {
      code = await pollForVerificationCode(ctx.agentInboxId, since, 45_000).catch(() => null);
    }
    // User's connected mailbox (Composio).
    if (!code) {
      code = await readConnectedOtp(ctx.domain).catch(() => null);
    }
    if (!code) return { text: "fill_otp: no code found yet — wait a few seconds and try again, or check the email address is correct." };

    const filled = await scriptedFillVerificationCode(ctx.page, code).catch(() => false);
    if (!filled) return { text: "fill_otp: got a code but found no code input on the page." };
    // Best-effort submit.
    for (const label of ["verify", "submit", "continue", "confirm"]) {
      if (await scriptedClickButton(ctx.page, label).catch(() => false)) break;
    }
    return { text: `fill_otp: filled a ${code.length}-digit code and submitted.` };
  },
};

/** Search the user's connected Gmail (Composio) for a fresh OTP. Returns the code, never logged. */
async function readConnectedOtp(domain: string): Promise<string | null> {
  const composio = getComposioClient();
  if (!(await composio.isConnected())) return null;
  const hits = await composio.searchEmail({
    from: domain,
    query: "code OR verification OR one-time OR passcode",
    newerThanDays: 1,
    limit: 5,
  });
  for (const hit of hits) {
    const msg = await composio.getMessage(hit.id);
    const code = extractCode(`${hit.subject} ${msg?.body ?? hit.snippet}`);
    if (code) return code;
  }
  return null;
}

const fillCardTool: CuaTool = {
  def: {
    name: "fill_card",
    description:
      "Fill the credit-card fields on the current payment page with the single-use card. The card number/CVV/expiry are injected securely and never shown to you. Returns how many fields were filled. (Refused on no-spend runs.)",
    parameters: { type: "object", properties: {} },
  },
  async run(ctx) {
    if (ctx.dryRun) {
      return { text: "fill_card: REFUSED — this is a no-spend run. Do not enter card details. Call read_total, then finish with status parked_payment." };
    }
    const { filled } = await scanAllFramesForCardFields(ctx.page, ctx.cdpCreds);
    return { text: filled > 0 ? `fill_card: filled ${filled} card field(s).` : "fill_card: no card fields found on this page yet." };
  },
};

const fillShippingTool: CuaTool = {
  def: {
    name: "fill_shipping",
    description: "Fill the shipping / contact form (email, name, address, city, state, zip, phone) with the saved details. Returns which fields were filled.",
    parameters: { type: "object", properties: {} },
  },
  async run(ctx) {
    const r = await scriptedFillShipping(ctx.page, ctx.shippingData);
    return { text: r.filled.length ? `fill_shipping: filled ${r.filled.join(", ")}.` : "fill_shipping: found no matching shipping fields (the page may use a different layout — fill visible fields with type+var)." };
  },
};

const readTotalTool: CuaTool = {
  def: {
    name: "read_total",
    description: "Read the order total currently shown on the page. Returns the total string or that none was found.",
    parameters: { type: "object", properties: {} },
  },
  async run(ctx) {
    const total = await extractVisibleTotal(ctx.page);
    return { text: total ? `read_total: ${total}.` : "read_total: no total visible on this page." };
  },
};

const finishTool: CuaTool = {
  def: {
    name: "finish",
    description:
      "End the task. status: confirmation (order placed — give order_number + total), parked_payment (reached the filled payment page on a no-spend run — give total), parked_login (signed in and stopping per instruction), error (blocked — explain in note).",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["confirmation", "parked_payment", "parked_login", "error"] },
        order_number: { type: "string" },
        total: { type: "string" },
        note: { type: "string" },
      },
      required: ["status"],
    },
  },
  async run(_ctx, args) {
    const status = (str(args.status) ?? "stopped") as CuaStatus;
    const finish: FinishResult = {
      status,
      orderNumber: str(args.order_number),
      total: str(args.total),
      note: str(args.note),
    };
    return { text: `finish: ${status}.`, finish };
  },
};

/**
 * The toolset offered to the agent. Currently uniform; `fill_card` self-guards
 * on dry-run and `login`/`fill_otp` no-op when nothing is configured, so the
 * model always sees one stable, generic interface. Kept as a builder so modes
 * (e.g. login-only) can prune tools later without touching the loop.
 */
export function buildToolset(_ctx: Pick<ToolContext, "dryRun">): CuaTool[] {
  return [
    clickTool,
    typeTool,
    selectTool,
    scrollTool,
    pressTool,
    dismissPopupsTool,
    loginTool,
    fillOtpTool,
    fillCardTool,
    fillShippingTool,
    readTotalTool,
    finishTool,
  ];
}

/**
 * Capability-only toolset for the native computer-use loop. Browser actions
 * (click/type/scroll/press/select/dismiss_popups) are handled by the computer
 * tool; only server-side capability tools are exposed here.
 */
export function buildCapabilityToolset(_ctx: Pick<ToolContext, "dryRun">): CuaTool[] {
  return [
    loginTool,
    fillOtpTool,
    fillCardTool,
    fillShippingTool,
    readTotalTool,
    finishTool,
  ];
}
