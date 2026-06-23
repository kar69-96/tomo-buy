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

interface SnapshotElement {
  ref: number;
  tag: string;
  type: string;
  name: string;
  text: string;
}

interface ActStep {
  action: "click" | "fill" | "select";
  ref: number;
  /** Name of a variable in `variables` whose value should be used. */
  var?: string;
  /** Literal value (use only for non-PII, e.g. a verification code). */
  value?: string;
}

export interface ActOptions {
  variables?: Record<string, string>;
  log?: (m: string) => void;
  maxSteps?: number;
}

const REF_ATTR = "data-tomo-ref";

async function snapshot(page: Page): Promise<SnapshotElement[]> {
  return (await page.evaluate((attr: string) => {
    const sel = 'a, button, input, select, textarea, [role="button"], [role="link"]';
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
      if (i >= 80) break;
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

const SYSTEM = `You drive a checkout page one batch of actions at a time. You are given an instruction and a numbered list of the page's interactive elements. Decide which elements to act on to accomplish the instruction.

Return STRICT JSON: {"steps":[{"action":"click|fill|select","ref":<number>,"var":"<variable name, for fill/select form values>","value":"<literal value, only for non-personal data like a verification code>"}]}

Rules:
- For form fields, prefer "var" referencing one of the provided variable names — never invent personal data.
- Only act on elements in the list, by their ref number.
- Keep it minimal: just the steps needed for THIS instruction.
- If nothing applies, return {"steps":[]}.`;

/**
 * Execute a natural-language instruction against the page via the LLM.
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

  const els = await snapshot(page);
  if (els.length === 0) return 0;

  const user = `Instruction: ${instruction}

Interactive elements:
${renderElements(els)}

Available variable names (use as "var" for form values; the real value is filled automatically): ${
    varNames.length > 0 ? varNames.join(", ") : "(none)"
  }

Return the JSON now.`;

  let parsed: { steps?: ActStep[] } | null = null;
  try {
    parsed = await completeJson<{ steps?: ActStep[] }>(SYSTEM, user, {
      model: getAgentModel(),
    });
  } catch (err) {
    log(`act: LLM error: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  const steps = parsed?.steps ?? [];
  let executed = 0;

  for (const step of steps) {
    if (typeof step.ref !== "number") continue;
    const locator = page.locator(`[${REF_ATTR}="${step.ref}"]`);
    try {
      if (step.action === "click") {
        await locator.click({ timeout: 8000 });
        executed++;
      } else if (step.action === "fill") {
        const value = step.var ? variables[step.var] ?? "" : step.value ?? "";
        if (!value) continue;
        await locator.fill(value, { timeout: 8000 });
        executed++;
      } else if (step.action === "select") {
        const value = step.var ? variables[step.var] ?? "" : step.value ?? "";
        if (!value) continue;
        await locator.selectOption({ label: value }).catch(async () => {
          await locator.selectOption(value);
        });
        executed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      log(`act: step ${step.action} #${step.ref} failed: ${msg}`);
    }
  }

  return executed;
}
