/**
 * Native Anthropic computer-use CUA loop.
 *
 * Uses the Anthropic SDK directly with the `computer_20241022` beta tool.
 * The model performs pixel-precise visual reasoning (trained on screenshots)
 * rather than DOM element refs — far less likely to misinterpret the objective
 * text as a search query.
 *
 * Architecture:
 *   computer_20241022 → all browser interactions (click, type, key, scroll, screenshot)
 *   Capability tools  → login / fill_card / fill_shipping / fill_otp / read_total / finish
 *                       (unchanged; secrets never reach the model)
 *
 * Activated when ANTHROPIC_API_KEY is set (and CUA_MODE != "tool-calling").
 * Override the model via CUA_NATIVE_MODEL (default: claude-sonnet-4-6).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolComputerUse20250124,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Page } from "playwright";
import { captureRedactedScreenshot } from "../redact.js";
import { pageSignature, advanced } from "../act.js";
import type { FinishResult } from "./tools.js";
import type { CuaResult, CuaParams } from "./loop.js";

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const STALL_LIMIT = 4;
const DEFAULT_MAX_TOOL_CALLS = (() => {
  const n = Number(process.env.AGENT_TOOL_CALLS_MAX);
  return Number.isFinite(n) && n > 0 ? n : 40;
})();

const NATIVE_MODEL =
  process.env.CUA_NATIVE_MODEL ?? "claude-sonnet-4-6";

export const NATIVE_SYSTEM = `You are a computer-use agent completing a purchasing task in a real web browser. You see the page as a screenshot and control the browser exclusively with the computer tool.

For sensitive, multi-field operations, use the dedicated capability tools:
- fill_shipping  → fills the shipping/contact form (email, name, address, etc.)
- fill_card      → injects the payment card securely (refused on no-spend runs)
- login          → signs in or creates an account with the pre-configured identity
- fill_otp       → fetches and fills an emailed one-time code
- read_total     → reads the order total from the current page
- finish         → ends the task (status: confirmation | parked_payment | parked_login | error)

Operating rules:
- Take a screenshot first to understand the current page state before acting.
- Close any cookie/promo/newsletter overlay before interacting with page content.
- Work in small steps — one or two actions per turn, then screenshot to verify.
- To click a button or link, use left_click at the CENTER pixel coordinate you see in the screenshot.
- To submit a form, either click the submit button or press key Enter.
- Only the viewport is visible; scroll down to reveal off-screen content.
- Some fields (card, PII) appear as solid black boxes — they are already filled. Never re-enter them.
- When the objective is complete, call finish immediately.`;

/** Parse a data URL into its MIME type and raw base64 payload. */
async function screenshotBase64(
  page: Page,
  piiValues: string[],
): Promise<{ data: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }> {
  const dataUrl = await captureRedactedScreenshot(page, { piiValues });
  if (!dataUrl) return { data: "", mediaType: "image/png" };
  // data:<mime>;base64,<payload>
  const semi = dataUrl.indexOf(";");
  const comma = dataUrl.indexOf(",");
  const mime = semi > 0 && comma > semi ? dataUrl.slice(5, semi) : "image/png";
  const mediaType = (
    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime) ? mime : "image/png"
  ) as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return { data, mediaType };
}

/** Map X11/Anthropic key names to Playwright key names. */
function toPlaywrightKey(key: string): string {
  const map: Record<string, string> = {
    Return: "Enter",
    BackSpace: "Backspace",
    Tab: "Tab",
    Escape: "Escape",
    space: " ",
    Page_Down: "PageDown",
    Page_Up: "PageUp",
    End: "End",
    Home: "Home",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown",
  };
  if (key.includes("+")) {
    return key.split("+").map((k) => map[k] ?? k).join("+");
  }
  return map[key] ?? key;
}

/** Execute one computer-tool action in Playwright then return a screenshot result. */
async function executeComputer(
  page: Page,
  action: string,
  input: Record<string, unknown>,
  piiValues: string[],
  log: (m: string) => void,
): Promise<BetaToolResultBlockParam & { tool_use_id: string }> {
  try {
    switch (action) {
      case "screenshot":
        break; // just capture below

      case "left_click": {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.click(x, y);
        log(`    click (${x},${y})`);
        await page.waitForTimeout(600);
        break;
      }
      case "right_click": {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.click(x, y, { button: "right" });
        await page.waitForTimeout(300);
        break;
      }
      case "double_click": {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.dblclick(x, y);
        await page.waitForTimeout(500);
        break;
      }
      case "middle_click": {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.click(x, y, { button: "middle" });
        await page.waitForTimeout(300);
        break;
      }
      case "type": {
        const text = input.text as string;
        await page.keyboard.type(text, { delay: 30 });
        log(`    type "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);
        await page.waitForTimeout(300);
        break;
      }
      case "key": {
        const raw = input.text as string;
        const key = toPlaywrightKey(raw);
        await page.keyboard.press(key);
        log(`    key ${raw}`);
        await page.waitForTimeout(300);
        break;
      }
      case "scroll": {
        const [x, y] = input.coordinate as [number, number];
        const dir = input.direction as string;
        const amt = (input.amount as number) ?? 3;
        await page.mouse.move(x, y);
        const dy = dir === "down" ? 300 * amt : dir === "up" ? -300 * amt : 0;
        const dx = dir === "right" ? 300 * amt : dir === "left" ? -300 * amt : 0;
        await page.mouse.wheel(dx, dy);
        log(`    scroll ${dir} x${amt}`);
        await page.waitForTimeout(400);
        break;
      }
      case "mouse_move": {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.move(x, y);
        await page.waitForTimeout(100);
        break;
      }
      case "left_click_drag": {
        const [sx, sy] = input.start_coordinate as [number, number];
        const [ex, ey] = input.coordinate as [number, number];
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.move(ex, ey);
        await page.mouse.up();
        log(`    drag (${sx},${sy})→(${ex},${ey})`);
        await page.waitForTimeout(500);
        break;
      }
    }
  } catch (err) {
    log(`    computer.${action} error: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
  }

  const { data: b64, mediaType } = await screenshotBase64(page, piiValues);
  return {
    type: "tool_result",
    tool_use_id: "", // filled by caller
    content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } }],
  };
}

export async function runCuaTaskNative(params: CuaParams): Promise<CuaResult> {
  const log = params.log ?? (() => {});
  const page = params.toolContext.page;
  const piiValues = params.piiValues ?? [];
  const maxToolCalls = params.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for native computer-use CUA");

  const anthropic = new Anthropic({ apiKey });

  await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H }).catch(() => {});

  // Computer tool
  const computerTool: BetaToolComputerUse20250124 = {
    type: "computer_20250124",
    name: "computer",
    display_width_px: VIEWPORT_W,
    display_height_px: VIEWPORT_H,
  };

  // Capability tools (no browser tools — computer handles those)
  const byName = new Map(params.tools.map((t) => [t.def.name, t] as const));
  const capabilityTools: BetaTool[] = params.tools.map((t) => ({
    name: t.def.name,
    description: t.def.description,
    input_schema: t.def.parameters as BetaTool["input_schema"],
  }));

  // Seed the conversation: objective + initial screenshot
  const { data: initB64, mediaType: initMediaType } = await screenshotBase64(page, piiValues);
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${params.objective}\n\nCurrent URL: ${page.url()}\n\nHere is the current browser state:`,
        },
        { type: "image", source: { type: "base64", media_type: initMediaType, data: initB64 } },
      ],
    },
  ];

  let toolCalls = 0;
  let rounds = 0;
  let stallRounds = 0;
  let sigBefore = await pageSignature(page);

  while (toolCalls < maxToolCalls) {
    rounds++;

    let response: BetaMessage;
    try {
      response = await anthropic.beta.messages.create({
        model: NATIVE_MODEL,
        max_tokens: 4096,
        system: NATIVE_SYSTEM,
        tools: [computerTool, ...capabilityTools],
        messages,
        betas: ["computer-use-2025-01-24"],
      });
    } catch (err) {
      log(`cua: model error: ${err instanceof Error ? err.message : String(err)}`);
      return { status: "error", note: "model call failed", toolCalls, rounds };
    }

    // Record the assistant turn
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      log("cua: model ended without finish");
      return { status: "stopped", note: "model ended without finish", toolCalls, rounds };
    }

    const toolUseBlocks = response.content.filter(
      (b): b is BetaToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      log("cua: no tool calls — stopping");
      return { status: "stopped", note: "no tool calls", toolCalls, rounds };
    }

    const results: BetaToolResultBlockParam[] = [];
    let finish: FinishResult | undefined;

    for (const block of toolUseBlocks) {
      toolCalls++;

      if (block.name === "computer") {
        const input = block.input as Record<string, unknown>;
        const action = input.action as string;
        log(`cua: computer.${action}`);
        const r = await executeComputer(page, action, input, piiValues, log);
        r.tool_use_id = block.id;
        results.push(r);
      } else {
        const tool = byName.get(block.name);
        if (!tool) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `unknown tool: ${block.name}`,
          });
          continue;
        }
        let toolResult;
        try {
          toolResult = await tool.run(params.toolContext, block.input as Record<string, unknown>);
        } catch (err) {
          toolResult = {
            text: `error: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
          };
        }
        log(`cua: ${block.name} → ${toolResult.text}`);
        results.push({ type: "tool_result", tool_use_id: block.id, content: toolResult.text });
        if (toolResult.finish) finish = toolResult.finish;
      }

      if (toolCalls >= maxToolCalls) break;
    }

    if (finish) return { ...finish, toolCalls, rounds };

    messages.push({ role: "user", content: results });

    // Stall detection
    const sigAfter = await pageSignature(page);
    if (advanced(sigBefore, sigAfter)) {
      stallRounds = 0;
    } else if (++stallRounds >= STALL_LIMIT) {
      log(`cua: stalled ${stallRounds} rounds — stopping`);
      return { status: "stopped", note: "no progress", toolCalls, rounds };
    }
    sigBefore = sigAfter;
  }

  log(`cua: budget exhausted (${toolCalls}/${maxToolCalls})`);
  return { status: "stopped", note: "tool-call budget exhausted", toolCalls, rounds };
}
