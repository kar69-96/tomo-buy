/**
 * OpenRouter-driven page action — the local replacement for Stagehand's
 * `stagehand.act(instruction, { variables })`.
 *
 * Given a natural-language instruction and the page's interactive elements, it
 * asks an LLM which elements to click/fill/select, then executes those steps
 * with Playwright.
 *
 * Trust boundary: form VALUES are never sent to the LLM. The model references
 * variable NAMES (e.g. "x_shipping_email"); the real value is substituted here
 * at execution time. Card fields are filled via CDP elsewhere and are never part
 * of `variables`.
 */

import type { Page } from "playwright";
import { completeJson, getAgentModel } from "./llm.js";
import { captureRedactedScreenshot } from "./redact.js";

/**
 * Vision is on by default; set AGENT_VISION=false/0/off to force the legacy
 * text-only decision path (e.g. to cut image-token cost).
 */
function visionEnabled(): boolean {
  const v = (process.env.AGENT_VISION ?? "").toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

export interface SnapshotElement {
  ref: number;
  tag: string;
  type: string;
  name: string;
  text: string;
}

interface ActStep {
  action: "click" | "fill" | "select" | "scroll" | "press";
  /** Element ref for fill/select (and optionally click); for scroll, optional. */
  ref?: number;
  /**
   * Pixel coordinates (viewport CSS px, as seen in the screenshot) for a vision
   * click — used to click a control that is visible but not in the element list.
   */
  x?: number;
  y?: number;
  /** Name of a variable in `variables` whose value should be used. */
  var?: string;
  /**
   * Literal value (non-PII): a scroll direction ("down"|"up"|"top"|"bottom"), or a
   * keyboard key for a "press" action ("Enter"|"Tab"|"Escape"|"ArrowDown"|…).
   */
  value?: string;
}

/** A secret-safe summary of one chosen step (no `value`/`var`, so no OTP/PII). */
export interface ActStepSummary {
  action: ActStep["action"];
  ref?: number;
  x?: number;
  y?: number;
}

/** Rich result of an act run — lets the caller see if the LLM actually did anything. */
export interface ActResult {
  /** Steps that executed successfully (clicked/filled/scrolled). */
  executed: number;
  /** Steps the model asked for (attempted to execute). */
  attempted: number;
  /** True if the model returned no parseable JSON in any decision round. */
  parseFailed: boolean;
  /** How many decision rounds actually ran. */
  rounds: number;
  /** Secret-safe summary of the steps the model chose (for tracing/debugging). */
  chosen: ActStepSummary[];
}

export interface ActOptions {
  variables?: Record<string, string>;
  log?: (m: string) => void;
  maxSteps?: number;
  /**
   * Iterative mode: re-snapshot between actions so the model can react to UI that
   * appears only after an interaction — autocomplete suggestion lists, date
   * pickers, expanding sections. Text inputs are typed with real keystrokes (not
   * `.fill()`) and a revealed suggestion list is accepted, so combobox/typeahead
   * fields (address autocomplete, location/date search, …) actually commit.
   * Generic across sites; no per-site logic.
   */
  iterative?: boolean;
  /**
   * Attach a redacted screenshot to each decision (vision). Defaults to the
   * AGENT_VISION env (on unless explicitly disabled). The screenshot is always
   * run through captureRedactedScreenshot — no card/PII pixels reach the model.
   */
  screenshot?: boolean;
  /**
   * Card data may be present on this page (payment stage). When true, the
   * screenshot redaction goes AGGRESSIVE: every input and iframe is covered, so
   * a freshly CDP-filled PAN can never be captured.
   */
  containsCardData?: boolean;
}

export const REF_ATTR = "data-tomo-ref";

export async function snapshot(page: Page): Promise<SnapshotElement[]> {
  try {
    return await snapshotInner(page);
  } catch {
    // A navigation in flight destroys the execution context mid-evaluate. Degrade
    // to "no elements" (the caller falls back to the screenshot) rather than throw,
    // matching pageSignature's swallow-and-default contract.
    return [];
  }
}

async function snapshotInner(page: Page): Promise<SnapshotElement[]> {
  return (await page.evaluate((attr: string) => {
    const semanticSel =
      'a, button, input, select, textarea, [role="button"], [role="link"], ' +
      '[role="option"], [role="combobox"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="tab"]';
    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      );
    };
    const out: Array<{ ref: number; tag: string; type: string; name: string; text: string }> = [];
    let i = 0;
    const pushEl = (el: Element): boolean => {
      el.setAttribute(attr, String(i));
      const anyEl = el as HTMLInputElement;
      const text = (
        (el as HTMLElement).innerText ||
        anyEl.value ||
        el.getAttribute("aria-label") ||
        anyEl.placeholder ||
        el.getAttribute("title") ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
      out.push({
        ref: i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        name: el.getAttribute("name") || el.id || "",
        text,
      });
      i++;
      return i < 120;
    };

    const seen = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll(semanticSel))) {
      if (!isVisible(el)) continue;
      seen.add(el);
      if (!pushEl(el)) return out;
    }
    // Also list custom-styled clickables (cursor:pointer leaf-ish elements that SPAs
    // build from <div>/<span> — modal ×, fare cards, menu items). Including them lets
    // the model target by precise ref instead of fragile pixel coordinates. Generic;
    // capped and limited to small, text-bearing, non-nested nodes to avoid flooding.
    for (const el of Array.from(document.querySelectorAll("div, span, li, label, p, i, svg"))) {
      if (seen.has(el) || el.hasAttribute(attr)) continue;
      if (!isVisible(el)) continue;
      if (window.getComputedStyle(el).cursor !== "pointer") continue;
      // Skip big containers; want the actual control. Allow tiny icon nodes (× close).
      const rect = el.getBoundingClientRect();
      if (rect.width > 420 || rect.height > 160) continue;
      // Prefer leaf-ish nodes (a clickable wrapper's children are usually clickable too).
      if (el.querySelectorAll("a, button, input, select, textarea").length > 0) continue;
      // Skip if an ancestor was already listed as clickable (dedupe nested pointers).
      let anc = el.parentElement;
      let nestedInClickable = false;
      for (let h = 0; anc && h < 4; h++) {
        if (anc.hasAttribute(attr)) { nestedInClickable = true; break; }
        anc = anc.parentElement;
      }
      if (nestedInClickable) continue;
      if (!pushEl(el)) return out;
    }
    return out;
  }, REF_ATTR)) as SnapshotElement[];
}

/**
 * The CSS-pixel viewport bounds to tell the model (it must give click x,y within
 * these). page.viewportSize() returns null for a CDP-attached page with no
 * emulated viewport, so fall back to the live window inner size. Matches the
 * scale:"css" screenshot, so reported bounds == image px == mouse px.
 */
export async function viewportDims(page: Page): Promise<{ width: number; height: number }> {
  const vp = page.viewportSize();
  if (vp && vp.width > 0 && vp.height > 0) return vp;
  try {
    return (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))) as { width: number; height: number };
  } catch {
    return { width: 0, height: 0 };
  }
}

export function renderElements(els: SnapshotElement[]): string {
  return els
    .map(
      (e) =>
        `[${e.ref}] <${e.tag}${e.type ? " " + e.type : ""}${e.name ? " name=" + e.name : ""}> ${e.text}`,
    )
    .join("\n");
}

const SYSTEM = `You drive a web page one batch of actions at a time, like a person looking at the screen. You are given an instruction, a SCREENSHOT of the current page, and a numbered list of SOME of the page's interactive elements. The screenshot is the source of truth for what is on screen — many real controls (links, buttons built from styled <div>/<span>) are NOT in the element list. Trust your eyes.

Return STRICT JSON: {"steps":[{"action":"click|fill|select|scroll|press","ref":<number, optional>,"x":<pixel, optional>,"y":<pixel, optional>,"var":"<variable name, for fill/select form values>","value":"<literal value: for a place/date/quantity/verification code from the instruction; for scroll a direction down|up|top|bottom; for press a key name Enter|Tab|Escape|ArrowDown>"}]}

How to target a control when CLICKING — two ways, pick the right one:
- If the control IS in the numbered element list, use its "ref".
- If you can SEE the control in the screenshot but it is NOT in the list (e.g. a "Log in", "Sign in", "Account", menu, or any custom-styled clickable), give the PIXEL COORDINATES of its CENTER as you see it in the screenshot: {"action":"click","x":<px>,"y":<px>}. The image's top-left is (0,0); x increases right, y increases down. Estimate the center of the visible text/button as precisely as you can. When several links sit side by side (e.g. "log in | sign up" or a row of menu items), aim at the CENTER OF THE EXACT WORD you want — NOT the middle of the whole group, or you'll hit the gap between them and nothing will happen.
- A "log in" / "sign in" / "account" control usually opens a login PANEL or DIALOG in place (the URL may not change). After clicking it, expect newly revealed email/password fields in the next screenshot and element list — fill those to continue. Clicking it is the right move even if nothing seemed to happen last turn; the system handles overlay-covered controls for you.
For FILL and SELECT you MUST use "ref" (you need a real input from the list). You may also return {"action":"press","value":"Enter"} (or Tab/Escape/ArrowDown) to submit a focused field, move between fields, or dismiss a blocking overlay.

Rules:
- The screenshot may have SOLID BLACK BOXES over some fields. These are intentionally redacted sensitive fields (card number, personal info) — NOT errors. Treat a black box as a normal, already-handled field; never try to "fix" or re-fill it.
- The screenshot shows only the CURRENT viewport. If what you need isn't visible, it likely continues below — use {"action":"scroll","value":"down"} to reveal more, then act. Scroll is also how you reach a button at the bottom of a long form.
- If a modal, dialog, cookie banner, or promo overlay is blocking the page, close it FIRST (click its ×/close/"no thanks") before anything else.
- For PERSONAL form fields (name, email, address, phone), prefer "var" referencing a provided variable name — never invent personal data.
- For NON-personal inputs whose value the instruction specifies (a place/location, a date, a quantity, a search term), use "value" with that literal.
- After filling an autocomplete/search field, the matching suggestion is accepted automatically — you do NOT need a separate step to click it.
- When choosing among priced options and the instruction doesn't pin one, pick the lowest-priced option that satisfies the requirements.
- Pick the few highest-impact steps toward the instruction; don't try to complete everything at once.
- If needed content is off-screen, return a single scroll step rather than {"steps":[]}.
- If nothing applies (or you're waiting for the page to update), return {"steps":[]}.`;

/**
 * Normalize a parsed model response into a step list. Be liberal in what we accept:
 * weaker models frequently return a bare array `[{action…}]`, a single inline step
 * object, or wrap the list under `actions`/`step` instead of `steps` — all of which a
 * strict `parsed.steps` read would silently drop (→ phantom no-op). Generic, no
 * per-site logic.
 */
export function normalizeSteps(parsed: unknown): ActStep[] {
  if (Array.isArray(parsed)) return parsed as ActStep[];
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const cand = o.steps ?? o.actions ?? o.step;
    if (Array.isArray(cand)) return cand as ActStep[];
    if (cand && typeof cand === "object") return [cand as ActStep];
    // The model returned a single inline step: {action:"click", ref:3}.
    if (typeof o.action === "string") return [o as unknown as ActStep];
  }
  return [];
}

interface DecideContext {
  /** Variable NAMES the model may reference (values are never sent). */
  varNames: string[];
  /** Real PII values to redact from the screenshot (never put in the prompt). */
  piiValues: string[];
  /** Attach a (redacted) screenshot to the decision. */
  useScreenshot: boolean;
  /** Card data may be present → screenshot redaction goes aggressive. */
  aggressive: boolean;
  /** Reflection: what the previous batch of actions did (empty on round 0). */
  priorOutcome: string;
  log: (m: string) => void;
}

/** Ask the model for the next batch of actions given the current page snapshot. */
async function decideSteps(
  page: Page,
  instruction: string,
  ctx: DecideContext,
): Promise<{ steps: ActStep[]; els: SnapshotElement[]; parseFailed: boolean }> {
  const els = await snapshot(page);
  if (els.length === 0 && !ctx.useScreenshot) {
    // No DOM controls and no screenshot to look at — nothing to act on.
    ctx.log("act: snapshot found no interactive elements and vision is off");
    return { steps: [], els, parseFailed: false };
  }

  // Capture AFTER the snapshot so refs are already tagged in the DOM. Always
  // redacted; null on failure → we proceed text-only (never an un-redacted shot).
  const shot = ctx.useScreenshot
    ? await captureRedactedScreenshot(page, {
        piiValues: ctx.piiValues,
        aggressive: ctx.aggressive,
      })
    : null;

  const reflection = ctx.priorOutcome
    ? `Result of your previous actions: ${ctx.priorOutcome}\n\n`
    : "";

  const vp = await viewportDims(page);
  const dims = vp.width > 0 ? `${vp.width}x${vp.height}` : "the image's";
  const user = `Instruction: ${instruction}

${reflection}Screenshot size: ${dims} pixels. For a click on something visible but not in the list below, return its center as "x"/"y" within these bounds.

Interactive elements (a PARTIAL list — the screenshot may show more clickable controls than appear here):
${renderElements(els)}

Available variable names (use as "var" for personal form values; the real value is filled automatically): ${
    ctx.varNames.length > 0 ? ctx.varNames.join(", ") : "(none)"
  }

Return the JSON now.`;

  try {
    const parsed = await completeJson<unknown>(SYSTEM, user, {
      model: getAgentModel(),
      images: shot ? [shot] : undefined,
      // Cap output: a short action batch never needs more, and an uncapped call can
      // run away (slow + truncated → unparseable JSON) on a complex page. Bounds
      // both latency and the risk of a cut-off response.
      maxTokens: 1024,
    });
    if (parsed === null) {
      // The model produced no parseable JSON even after the strict retry. This is
      // the silent killer: without this log it looks identical to "page is done".
      ctx.log(
        `act: model returned no parseable JSON (model=${getAgentModel()}, ${els.length} elements${shot ? ", +screenshot" : ", text-only"})`,
      );
      return { steps: [], els, parseFailed: true };
    }
    const steps = normalizeSteps(parsed);
    if (steps.length === 0) {
      ctx.log(`act: model parsed OK but chose no actions (model=${getAgentModel()})`);
    }
    return { steps, els, parseFailed: false };
  } catch (err) {
    ctx.log(`act: LLM error: ${err instanceof Error ? err.message : String(err)}`);
    return { steps: [], els, parseFailed: false };
  }
}

/**
 * After typing into a field, accept a revealed autocomplete/typeahead suggestion.
 * Generic: if a listbox/option popup appeared, take the keyboard path that virtually
 * every combobox supports (ArrowDown → Enter). No-op when no suggestions appeared.
 */
export async function acceptAutocomplete(page: Page): Promise<void> {
  const hasOptions = await page
    .evaluate(() => {
      const opts = document.querySelectorAll(
        '[role="option"], [role="listbox"] li, [class*="autocomplete" i] li, [class*="suggestion" i], [class*="typeahead" i] li',
      );
      for (const o of opts) {
        const r = (o as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
      return false;
    })
    .catch(() => false);
  if (!hasOptions) return;
  try {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  } catch {
    /* best-effort */
  }
}

/**
 * A cheap, generic fingerprint of the page used to tell whether an action actually
 * moved the page forward — a navigation, a revealed dialog, or a chunk of new DOM
 * (e.g. a login panel that opens IN PLACE without a URL change). Site-agnostic.
 */
export interface PageSignature {
  url: string;
  title: string;
  elCount: number;
  visInputs: number;
  visDialogs: number;
  /** Count of elements with aria-expanded="true" (panels/dropdowns/flyouts). */
  ariaExpanded: number;
  /** Text content of common cart-count elements — changes when items are added. */
  cartCountText: string;
}

export async function pageSignature(page: Page): Promise<PageSignature> {
  try {
    return (await page.evaluate(() => {
      const isVis = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none";
      };
      let visInputs = 0;
      for (const i of Array.from(document.querySelectorAll("input, textarea, select"))) {
        if (isVis(i)) visInputs++;
      }
      let visDialogs = 0;
      for (const d of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))) {
        if (isVis(d)) visDialogs++;
      }
      // Count panels/menus/flyouts that are currently expanded.
      const ariaExpanded = document.querySelectorAll('[aria-expanded="true"]').length;
      // Cart count: look for common cart-count patterns across e-commerce sites.
      const cartEl = document.querySelector(
        '[data-qa="cart-count"], [data-testid*="cart-count" i], [data-testid*="bag-count" i], ' +
        '[aria-label*="bag" i] [data-quantity], [aria-label*="cart" i] [data-quantity], ' +
        '.cart-count, .bag-count, [class*="CartCount" i], [class*="cartCount" i]',
      );
      const cartCountText = cartEl ? (cartEl.textContent ?? "").trim() : "";
      return {
        url: location.href,
        title: document.title,
        elCount: document.querySelectorAll("*").length,
        visInputs,
        visDialogs,
        ariaExpanded,
        cartCountText,
      };
    })) as PageSignature;
  } catch {
    return { url: page.url(), title: "", elCount: 0, visInputs: 0, visDialogs: 0, ariaExpanded: 0, cartCountText: "" };
  }
}

/**
 * Did the page meaningfully advance between two signatures? True on any navigation,
 * title change, a newly revealed dialog or input (a panel/modal opened in place), or
 * a large DOM addition. A small element-count DECREASE is treated as ambient churn
 * (ad/deal tickers re-rendering), NOT progress — so we don't false-positive on noise.
 */
export function advanced(before: PageSignature, after: PageSignature): boolean {
  if (before.url !== after.url) return true;
  if (before.title !== after.title) return true;
  // A newly revealed dialog/modal is a strong, low-noise progress signal.
  if (after.visDialogs > before.visDialogs) return true;
  // A real form revealed (≥2 new visible inputs) — one stray input is ambient churn.
  if (after.visInputs - before.visInputs >= 2) return true;
  // A substantial DOM addition (a panel/menu mounting). A high threshold so ad/deal
  // tickers re-rendering a few nodes don't read as progress; a small DECREASE is noise.
  if (after.elCount - before.elCount >= 40) return true;
  // A panel/dropdown/flyout that newly opened (e.g. Nike mini-cart after Add to Bag).
  if (after.ariaExpanded > before.ariaExpanded) return true;
  // Cart count changed — item was successfully added to bag.
  if (after.cartCountText !== before.cartCountText && after.cartCountText !== "") return true;
  return false;
}

/**
 * A cheap page signature for tight polling. Identical to {@link pageSignature}
 * EXCEPT it skips the `document.querySelectorAll("*").length` full-DOM scan — the
 * one O(all-nodes) field — and carries `baseElCount` forward instead, so the
 * elCount-delta branch in {@link advanced} can never fire on lite data (the delta
 * is always 0). All the other progress signals (url/title/dialogs/inputs/aria/cart)
 * are specific-selector queries and stay. Use this only inside {@link waitForAdvance};
 * the authoritative before/after comparison still uses the full signature.
 */
export async function pageSignatureLite(page: Page, baseElCount: number): Promise<PageSignature> {
  try {
    return (await page.evaluate((base: number) => {
      const isVis = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none";
      };
      let visInputs = 0;
      for (const i of Array.from(document.querySelectorAll("input, textarea, select"))) {
        if (isVis(i)) visInputs++;
      }
      let visDialogs = 0;
      for (const d of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))) {
        if (isVis(d)) visDialogs++;
      }
      const ariaExpanded = document.querySelectorAll('[aria-expanded="true"]').length;
      const cartEl = document.querySelector(
        '[data-qa="cart-count"], [data-testid*="cart-count" i], [data-testid*="bag-count" i], ' +
        '[aria-label*="bag" i] [data-quantity], [aria-label*="cart" i] [data-quantity], ' +
        '.cart-count, .bag-count, [class*="CartCount" i], [class*="cartCount" i]',
      );
      const cartCountText = cartEl ? (cartEl.textContent ?? "").trim() : "";
      return {
        url: location.href,
        title: document.title,
        elCount: base,
        visInputs,
        visDialogs,
        ariaExpanded,
        cartCountText,
      };
    }, baseElCount)) as PageSignature;
  } catch {
    return { url: page.url(), title: "", elCount: baseElCount, visInputs: 0, visDialogs: 0, ariaExpanded: 0, cartCountText: "" };
  }
}

/**
 * Wait for the page to meaningfully advance from `before`, polling cheaply and
 * returning THE INSTANT it does — instead of sleeping a fixed duration and checking
 * once. Polls {@link pageSignatureLite} every `interval` ms up to `timeout`; on the
 * first detected advance (or on final timeout) it takes ONE authoritative full
 * {@link pageSignature}. Fast pages return in ~150–300ms; slow pages keep the full
 * `timeout` cap, so worst-case behavior is unchanged. Generic; no site logic.
 */
export async function waitForAdvance(
  page: Page,
  before: PageSignature,
  opts?: { timeout?: number; interval?: number },
): Promise<{ moved: boolean; signature: PageSignature }> {
  const timeout = opts?.timeout ?? 900;
  const interval = opts?.interval ?? 120;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(interval);
    const lite = await pageSignatureLite(page, before.elCount);
    if (advanced(before, lite)) {
      return { moved: true, signature: await pageSignature(page) };
    }
  }
  const full = await pageSignature(page);
  return { moved: advanced(before, full), signature: full };
}

const VREF = "data-tomo-vref";

/**
 * Snap a screenshot pixel to the real clickable control there. Uses the full
 * hit-test STACK (`elementsFromPoint`), not just the topmost element, so a styled
 * clickable sitting UNDER a transparent overlay (common on SPA headers — an
 * invisible sibling div with `pointer-events:auto` covers the real "log in" link)
 * is still found and tagged. Returns whether a clickable was found and whether it
 * is the topmost hit (i.e. NOT occluded), so the caller can pick a trusted click vs
 * an overlay-bypassing dispatch. Generic; no per-site logic.
 */
async function snapToClickable(
  page: Page,
  x: number,
  y: number,
): Promise<{ found: boolean; occluded: boolean }> {
  try {
    return (await page.evaluate(
      ({ x, y, attr }) => {
        const clickableSel =
          'a, button, input, select, textarea, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="radio"], [role="checkbox"], [onclick]';
        const isClickable = (el: Element): boolean =>
          !!(el.matches && el.matches(clickableSel)) || getComputedStyle(el).cursor === "pointer";
        const stack = document.elementsFromPoint(x, y);
        for (let idx = 0; idx < stack.length; idx++) {
          const el = stack[idx];
          if (isClickable(el)) {
            el.setAttribute(attr, "1");
            return { found: true, occluded: idx > 0 };
          }
        }
        // Fallback: walk up from the topmost element (handles a clickable wrapper).
        let node: Element | null = stack[0] ?? document.elementFromPoint(x, y);
        for (let hops = 0; node && hops < 6; hops++) {
          if (isClickable(node)) {
            node.setAttribute(attr, "1");
            return { found: true, occluded: hops > 0 };
          }
          node = node.parentElement;
        }
        return { found: false, occluded: false };
      },
      { x, y, attr: VREF },
    )) as { found: boolean; occluded: boolean };
  } catch {
    return { found: false, occluded: false };
  }
}

/** Remove the transient snap marker. */
async function clearVref(page: Page): Promise<void> {
  await page
    .evaluate((attr) => document.querySelectorAll(`[${attr}]`).forEach((e) => e.removeAttribute(attr)), VREF)
    .catch(() => {});
}

/**
 * Dispatch a full pointer+mouse press sequence on the snapped element at the model's
 * exact pixel. This reaches a control's own handler even when a transparent overlay
 * would swallow a real pointer event, and preserves clientX/clientY for controls
 * whose single handler picks an action by where you clicked (e.g. one "log in | sign
 * up" div). Generic; fires only on the element the model aimed at.
 */
async function dispatchSyntheticClick(page: Page, x: number, y: number): Promise<void> {
  await page
    .evaluate(
      ({ x, y, attr }) => {
        const el = document.querySelector(`[${attr}]`);
        if (!el) return;
        const o = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          button: 0,
          view: window,
        } as PointerEventInit & MouseEventInit;
        el.dispatchEvent(new PointerEvent("pointerover", o));
        el.dispatchEvent(new PointerEvent("pointerdown", { ...o, buttons: 1 }));
        el.dispatchEvent(new MouseEvent("mousedown", { ...o, buttons: 1 }));
        el.dispatchEvent(new PointerEvent("pointerup", o));
        el.dispatchEvent(new MouseEvent("mouseup", o));
        el.dispatchEvent(new MouseEvent("click", o));
      },
      { x, y, attr: VREF },
    )
    .catch(() => {});
}

/** A real, trusted point click via the browser input pipeline (move → down → up). */
async function realPointerClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: 6 });
  await page.waitForTimeout(90);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/**
 * Robustly click what the model SAW at (x, y). Escalation, each rung checked for a
 * real page change before the next (so we never blindly double-fire and toggle a
 * just-opened panel shut):
 *   1. snap to the real clickable in the hit-stack (overlay-aware);
 *   2. if it's the topmost hit → a trusted point click at the exact pixel;
 *   3. if that didn't advance (or it was occluded) → a synthetic event sequence on
 *      the snapped element at the exact pixel (bypasses a transparent overlay,
 *      drives coordinate-dependent handlers);
 *   4. last resort with nothing snapped → a raw trusted point click.
 * Returns whether the page advanced. Fully generic — no site/URL checks.
 */
export async function visionClick(
  page: Page,
  x: number,
  y: number,
  log: (m: string) => void = () => {},
): Promise<{ landed: boolean; moved: boolean }> {
  const before = await pageSignature(page);
  const snap = await snapToClickable(page, x, y);
  let how = "";
  try {
    if (snap.found && !snap.occluded) {
      await realPointerClick(page, x, y);
      how = "trusted";
      if ((await waitForAdvance(page, before)).moved) {
        log(`act: vision click (${x},${y}) via ${how} → advanced`);
        return { landed: true, moved: true };
      }
    }
    if (snap.found) {
      await dispatchSyntheticClick(page, x, y);
      how = how ? `${how}+synthetic` : "synthetic";
      if ((await waitForAdvance(page, before)).moved) {
        log(`act: vision click (${x},${y}) via ${how} → advanced`);
        return { landed: true, moved: true };
      }
    }
    if (!snap.found) {
      await realPointerClick(page, x, y);
      how = "raw-point";
      await page.waitForTimeout(900);
    }
  } finally {
    await clearVref(page);
  }
  const moved = advanced(before, await pageSignature(page));
  // If we found and fired on a real element (snap.found), consider the click
  // "landed" even when the page change is below the advanced() threshold (e.g.
  // a size-selector CSS class toggle). reportAdvance's "check screenshot" branch
  // handles this case: it tells the model to look at the screenshot and proceed
  // if the effect is visible, or try a different approach if nothing changed.
  // Only return landed:false when no clickable was found at all.
  log(`act: vision click (${x},${y}) via ${how || "none"} → ${moved ? "advanced" : snap.found ? "sub-threshold change (landed)" : "no visible change"}`);
  return { landed: snap.found || moved, moved };
}

const oneLine = (err: unknown): string =>
  err instanceof Error ? err.message.split("\n")[0] : String(err);

/** Locate a snapshot element by its `data-tomo-ref`. */
export function refLocator(page: Page, ref: number) {
  return page.locator(`[${REF_ATTR}="${ref}"]`);
}

/** Click an element by its snapshot ref. Returns whether the click landed. */
export async function clickRef(
  page: Page,
  ref: number,
  log: (m: string) => void = () => {},
): Promise<boolean> {
  try {
    await refLocator(page, ref).click({ timeout: 8000 });
    return true;
  } catch (err) {
    log(`act: click #${ref} failed: ${oneLine(err)}`);
    return false;
  }
}

/**
 * Type a value into the input at `ref`. In iterative mode types with real
 * keystrokes (drives autocomplete/typeahead handlers) and accepts a revealed
 * suggestion; otherwise a single `.fill()`. Caller resolves any %var% first —
 * a card/password value must NEVER be passed here (it goes through CDP fill).
 */
export async function typeRef(
  page: Page,
  ref: number,
  value: string,
  iterative = true,
  log: (m: string) => void = () => {},
): Promise<boolean> {
  if (!value) return false;
  const locator = refLocator(page, ref);
  try {
    if (iterative) {
      await locator.click({ timeout: 8000 });
      await locator.fill("", { timeout: 4000 }).catch(() => {});
      await locator.pressSequentially(value, { delay: 60, timeout: 8000 });
      await page.waitForTimeout(700);
      await acceptAutocomplete(page);
    } else {
      await locator.fill(value, { timeout: 8000 });
    }
    return true;
  } catch (err) {
    log(`act: type #${ref} failed: ${oneLine(err)}`);
    return false;
  }
}

/** Choose an option (by label, falling back to value) in the select at `ref`. */
export async function selectRef(
  page: Page,
  ref: number,
  value: string,
  log: (m: string) => void = () => {},
): Promise<boolean> {
  if (!value) return false;
  try {
    await refLocator(page, ref)
      .selectOption({ label: value })
      .catch(async () => {
        await refLocator(page, ref).selectOption(value);
      });
    return true;
  } catch (err) {
    log(`act: select #${ref} failed: ${oneLine(err)}`);
    return false;
  }
}

/** Scroll the page (or a ref into view). Direction: down|up|top|bottom. */
export async function scrollPage(
  page: Page,
  direction = "down",
  ref?: number,
  log: (m: string) => void = () => {},
): Promise<boolean> {
  try {
    if (typeof ref === "number") {
      await refLocator(page, ref).scrollIntoViewIfNeeded({ timeout: 4000 });
    } else {
      const dir = direction.toLowerCase();
      await page.evaluate((d: string) => {
        const h = window.innerHeight;
        if (d === "top") window.scrollTo({ top: 0 });
        else if (d === "bottom") window.scrollTo({ top: document.body.scrollHeight });
        else window.scrollBy({ top: d === "up" ? -h * 0.8 : h * 0.8 });
      }, dir);
    }
    await page.waitForTimeout(500);
    return true;
  } catch (err) {
    log(`act: scroll failed: ${oneLine(err)}`);
    return false;
  }
}

/** Press a keyboard key (Enter | Tab | Escape | ArrowDown | …). */
export async function pressKey(
  page: Page,
  key: string,
  log: (m: string) => void = () => {},
): Promise<boolean> {
  const k = (key || "").trim();
  if (!k) return false;
  try {
    await page.keyboard.press(k);
    await page.waitForTimeout(400);
    return true;
  } catch (err) {
    log(`act: press ${k} failed: ${oneLine(err)}`);
    return false;
  }
}

/** Execute one resolved step. Returns true if it acted. */
async function execStep(
  page: Page,
  step: ActStep,
  variables: Record<string, string>,
  iterative: boolean,
  log: (m: string) => void,
): Promise<boolean> {
  if (step.action === "scroll") {
    return scrollPage(page, step.value || "down", step.ref, log);
  }
  if (step.action === "press") {
    return pressKey(page, step.value || "", log);
  }
  // Vision click by pixel coordinates (overlay-aware; see visionClick).
  if (step.action === "click" && typeof step.x === "number" && typeof step.y === "number") {
    try {
      return (await visionClick(page, step.x, step.y, log)).landed;
    } catch (err) {
      log(`act: vision click (${step.x},${step.y}) failed: ${oneLine(err)}`);
      return false;
    }
  }
  if (typeof step.ref !== "number") return false;
  if (step.action === "click") return clickRef(page, step.ref, log);
  const value = step.var ? variables[step.var] ?? "" : step.value ?? "";
  if (step.action === "fill") return typeRef(page, step.ref, value, iterative, log);
  if (step.action === "select") return selectRef(page, step.ref, value, log);
  return false;
}

/**
 * Execute a natural-language instruction against the page via the LLM.
 *
 * Default (single-pass) mode keeps the legacy contract: one snapshot, one batch.
 * Iterative mode re-snapshots between batches so the model can chase UI that only
 * appears after an action (suggestion lists, date pickers), and types with real keys.
 *
 * Returns an {@link ActResult}: how many steps executed vs. were attempted, whether
 * the model failed to produce parseable JSON, and a secret-safe summary of the chosen
 * actions — so the caller can distinguish a real no-op (model did nothing) from progress.
 */
export async function playwrightAct(
  page: Page,
  instruction: string,
  options: ActOptions = {},
): Promise<ActResult> {
  const log = options.log ?? (() => {});
  const variables = options.variables ?? {};
  const varNames = Object.keys(variables);
  const iterative = options.iterative ?? false;
  const maxSteps = options.maxSteps ?? (iterative ? 9 : 1);

  // PII values only ever reach the screenshot redactor, never the prompt.
  const piiValues = Object.values(variables);
  const useScreenshot = options.screenshot ?? visionEnabled();
  const aggressive = options.containsCardData ?? false;

  let executed = 0;
  let attempted = 0;
  let rounds = 0;
  let parseFailed = false;
  let idleRounds = 0;
  let priorOutcome = "";
  const chosen: ActStepSummary[] = [];

  for (let round = 0; round < maxSteps; round++) {
    rounds++;
    const sigBefore = await pageSignature(page);
    const decision = await decideSteps(page, instruction, {
      varNames,
      piiValues,
      useScreenshot,
      aggressive,
      priorOutcome,
      log,
    });
    const steps = decision.steps;
    if (decision.parseFailed) parseFailed = true;

    if (steps.length === 0) {
      // Nothing to do this round. In iterative mode give the page one chance to
      // settle (a suggestion list may still be rendering) before giving up.
      if (!iterative || ++idleRounds >= 2) break;
      await page.waitForTimeout(800);
      continue;
    }
    idleRounds = 0;

    // Track which refs failed to act so the next round can avoid them — this is
    // what turns a stuck loop (re-clicking a disabled button forever) into a
    // self-correcting one. We never record `value`/`var` (could hold an OTP/PII).
    const failed: string[] = [];
    for (const step of steps) {
      const where = typeof step.ref === "number"
        ? `ref ${step.ref}`
        : typeof step.x === "number" && typeof step.y === "number"
          ? `(${step.x},${step.y})`
          : undefined;
      chosen.push({ action: step.action, ref: step.ref, x: step.x, y: step.y });
      attempted++;
      if (await execStep(page, step, variables, iterative, log)) executed++;
      else if (where) failed.push(where);
    }

    if (!iterative) break;

    await page.waitForTimeout(900);
    // The page advanced — a navigation, OR a panel/dialog/inputs revealed in place
    // (a login modal opening without a URL change). Hand control back to the outer
    // loop so it can re-detect the page type (e.g. now a login gate).
    if (advanced(sigBefore, await pageSignature(page))) break;

    // Reflection: feed concrete failures back so the model changes tack instead of
    // re-issuing the same no-op. A target that didn't act is wrong (not there,
    // covered, or off-screen) — for a vision click the coordinates likely missed.
    priorOutcome = failed.length
      ? `your action(s) on [${failed.join(", ")}] did NOT work and the page did NOT change — the target wasn't hit (a coordinate likely missed the control, or the element is covered/off-screen). Do NOT repeat the same target. Re-read the screenshot and aim at the CENTER of the exact control you want, try a nearby alternative, close any overlay, or scroll to reveal it.`
      : "the page did NOT change; the action may have had no effect. If you see no progress toward the instruction, try a DIFFERENT control (a different button, a dropdown option, or scroll to reveal one).";
  }

  if (executed === 0) {
    const why = parseFailed
      ? "model returned no parseable JSON"
      : attempted === 0
        ? "model chose no actions"
        : "all chosen actions failed to execute";
    log(`act: no-op — ${why} (rounds=${rounds}, attempted=${attempted})`);
  }

  return { executed, attempted, parseFailed, rounds, chosen };
}
