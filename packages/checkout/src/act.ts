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

interface SnapshotElement {
  ref: number;
  tag: string;
  type: string;
  name: string;
  text: string;
}

interface ActStep {
  action: "click" | "fill" | "select" | "scroll";
  /** Element ref for click/fill/select; for scroll, optional (scrolls it into view). */
  ref?: number;
  /** Name of a variable in `variables` whose value should be used. */
  var?: string;
  /** Literal value (non-PII), or a scroll direction: "down"|"up"|"top"|"bottom". */
  value?: string;
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

const REF_ATTR = "data-tomo-ref";

async function snapshot(page: Page): Promise<SnapshotElement[]> {
  return (await page.evaluate((attr: string) => {
    const sel =
      'a, button, input, select, textarea, [role="button"], [role="link"], ' +
      '[role="option"], [role="combobox"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="tab"]';
    const els = Array.from(document.querySelectorAll(sel));
    const out: Array<{ ref: number; tag: string; type: string; name: string; text: string }> = [];
    let i = 0;
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible =
        rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible) continue;
      el.setAttribute(attr, String(i));
      const anyEl = el as HTMLInputElement;
      const text = (
        (el as HTMLElement).innerText ||
        anyEl.value ||
        el.getAttribute("aria-label") ||
        anyEl.placeholder ||
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
      if (i >= 120) break;
    }
    return out;
  }, REF_ATTR)) as SnapshotElement[];
}

function renderElements(els: SnapshotElement[]): string {
  return els
    .map(
      (e) =>
        `[${e.ref}] <${e.tag}${e.type ? " " + e.type : ""}${e.name ? " name=" + e.name : ""}> ${e.text}`,
    )
    .join("\n");
}

const SYSTEM = `You drive a web page one batch of actions at a time. You are given an instruction, a screenshot of the current page, and a numbered list of the page's interactive elements. Use the screenshot to understand layout, what is visible, and what is blocking; use the element list to choose what to act on. Decide which elements to act on to make progress on the instruction.

Return STRICT JSON: {"steps":[{"action":"click|fill|select|scroll","ref":<number>,"var":"<variable name, for fill/select form values>","value":"<literal value, only for non-personal data from the instruction, e.g. a place, date, quantity, or verification code; or for scroll a direction: down|up|top|bottom>"}]}

Rules:
- The screenshot may have SOLID BLACK BOXES over some fields. These are intentionally redacted sensitive fields (card number, personal info) — they are NOT errors or missing content. Treat a black box as a normal, already-handled field; never try to "fix" or re-fill it.
- The element list is the source of truth for actions: always act by "ref" number, even for an element you can only see in the screenshot.
- The screenshot shows only the CURRENT viewport. If the option/button you need (an option to select, a price, a Continue button) is not visible, the page likely continues below — use {"action":"scroll","value":"down"} to reveal more, then act on what appears. Scroll is also how you reach a primary action button at the bottom of a long form.
- If a modal, dialog, cookie banner, or promo overlay is blocking the page, close it FIRST (click its ×/close/"no thanks" control) before anything else.
- For PERSONAL form fields (name, email, address, phone), prefer "var" referencing a provided variable name — never invent personal data.
- For NON-personal inputs whose value the instruction specifies (a place/location, a date, a quantity, a search term), use "value" with that literal.
- After filling an autocomplete/search field, the matching suggestion is accepted automatically — you do NOT need a separate step to click it.
- When choosing among priced options (search results, plans, tiers, variants) and the instruction doesn't pin one, pick the lowest-priced option that satisfies the stated requirements.
- Act only on elements in the list, by ref number. Pick the few highest-impact steps toward the instruction; don't try to complete everything at once.
- If you cannot make progress because needed content is off-screen, return a single scroll step rather than {"steps":[]}.
- If nothing applies (or you're waiting for the page to update), return {"steps":[]}.`;

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
): Promise<{ steps: ActStep[]; els: SnapshotElement[] }> {
  const els = await snapshot(page);
  if (els.length === 0) return { steps: [], els };

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

  const user = `Instruction: ${instruction}

${reflection}Interactive elements:
${renderElements(els)}

Available variable names (use as "var" for personal form values; the real value is filled automatically): ${
    ctx.varNames.length > 0 ? ctx.varNames.join(", ") : "(none)"
  }

Return the JSON now.`;

  try {
    const parsed = await completeJson<{ steps?: ActStep[] }>(SYSTEM, user, {
      model: getAgentModel(),
      images: shot ? [shot] : undefined,
    });
    return { steps: parsed?.steps ?? [], els };
  } catch (err) {
    ctx.log(`act: LLM error: ${err instanceof Error ? err.message : String(err)}`);
    return { steps: [], els };
  }
}

/**
 * After typing into a field, accept a revealed autocomplete/typeahead suggestion.
 * Generic: if a listbox/option popup appeared, take the keyboard path that virtually
 * every combobox supports (ArrowDown → Enter). No-op when no suggestions appeared.
 */
async function acceptAutocomplete(page: Page): Promise<void> {
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

/** Execute one resolved step. Returns true if it acted. */
async function execStep(
  page: Page,
  step: ActStep,
  variables: Record<string, string>,
  iterative: boolean,
  log: (m: string) => void,
): Promise<boolean> {
  if (step.action === "scroll") {
    const dir = (step.value || "down").toLowerCase();
    try {
      if (typeof step.ref === "number") {
        await page
          .locator(`[${REF_ATTR}="${step.ref}"]`)
          .scrollIntoViewIfNeeded({ timeout: 4000 });
      } else {
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
      log(`act: scroll failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      return false;
    }
  }

  if (typeof step.ref !== "number") return false;
  const locator = page.locator(`[${REF_ATTR}="${step.ref}"]`);
  try {
    if (step.action === "click") {
      await locator.click({ timeout: 8000 });
      return true;
    }
    if (step.action === "fill") {
      const value = step.var ? variables[step.var] ?? "" : step.value ?? "";
      if (!value) return false;
      if (iterative) {
        // Real keystrokes drive the same input handlers a user does — required to
        // populate autocomplete/typeahead suggestion lists that `.fill()` skips.
        await locator.click({ timeout: 8000 });
        await locator.fill("", { timeout: 4000 }).catch(() => {});
        await locator.pressSequentially(value, { delay: 60, timeout: 8000 });
        await page.waitForTimeout(700);
        await acceptAutocomplete(page);
      } else {
        await locator.fill(value, { timeout: 8000 });
      }
      return true;
    }
    if (step.action === "select") {
      const value = step.var ? variables[step.var] ?? "" : step.value ?? "";
      if (!value) return false;
      await locator.selectOption({ label: value }).catch(async () => {
        await locator.selectOption(value);
      });
      return true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    log(`act: step ${step.action} #${step.ref} failed: ${msg}`);
  }
  return false;
}

/**
 * Execute a natural-language instruction against the page via the LLM.
 *
 * Default (single-pass) mode keeps the legacy contract: one snapshot, one batch.
 * Iterative mode re-snapshots between batches so the model can chase UI that only
 * appears after an action (suggestion lists, date pickers), and types with real keys.
 *
 * Returns the number of steps successfully executed.
 */
export async function playwrightAct(
  page: Page,
  instruction: string,
  options: ActOptions = {},
): Promise<number> {
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
  let idleRounds = 0;
  let priorOutcome = "";

  for (let round = 0; round < maxSteps; round++) {
    const startUrl = page.url();
    const { steps } = await decideSteps(page, instruction, {
      varNames,
      piiValues,
      useScreenshot,
      aggressive,
      priorOutcome,
      log,
    });

    if (steps.length === 0) {
      // Nothing to do this round. In iterative mode give the page one chance to
      // settle (a suggestion list may still be rendering) before giving up.
      if (!iterative || ++idleRounds >= 2) break;
      await page.waitForTimeout(800);
      continue;
    }
    idleRounds = 0;

    for (const step of steps) {
      if (await execStep(page, step, variables, iterative, log)) executed++;
    }

    if (!iterative) break;

    await page.waitForTimeout(900);
    // A navigation means the page advanced — hand control back to the outer loop
    // so it can re-detect the page type.
    if (page.url() !== startUrl) break;

    // Reflection: tell the next round whether the last batch changed anything,
    // so the model can change tack instead of re-issuing a no-op action.
    priorOutcome =
      "the page did NOT navigate; it may have updated in place, or the action had no effect. If you see no progress toward the instruction, try a DIFFERENT control (a different button, a dropdown option, or scroll to reveal one).";
  }

  return executed;
}
