/**
 * OpenRouter chat client (fetch-based, no SDK dependency).
 *
 * Every model call in checkout and discovery goes through `complete()`. The
 * in-checkout browser agent can be routed to Google Gemini (the production-
 * recommended provider) by setting LLM_PROVIDER=gemini + GEMINI_API_KEY; the
 * default is OpenRouter so the repo runs out of the box. Card numbers MUST
 * NEVER be passed to these functions — only sanitized page text, instructions,
 * and %var% placeholders.
 */

import { getLlmProvider } from "@tomo/core";
import { geminiComplete } from "./gemini.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is required (set it in .env). Get one at https://openrouter.ai/keys",
    );
  }
  return key;
}

/** Model for the in-checkout browser agent (action selection). */
export function getAgentModel(): string {
  return process.env.AGENT_MODEL || "openai/gpt-4o-mini";
}

/** Model for discovery / structured extraction. */
export function getExtractModel(): string {
  return process.env.INTENT_MODEL || process.env.AGENT_MODEL || "openai/gpt-4o-mini";
}

/** A text segment of a (possibly multimodal) message. */
export interface TextPart {
  type: "text";
  text: string;
}

/**
 * An image segment, as an OpenAI-style `image_url` block. `url` is a base64
 * `data:` URL. NEVER place a screenshot here that has not been through
 * `captureRedactedScreenshot` — see redact.ts and the prime directive.
 */
export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

/**
 * One tool call the model asked for. `arguments` is the raw JSON string the
 * provider returned; `parseToolArgs` turns it into an object. NEVER place a
 * secret in a tool call's arguments or result — see the prime directive.
 */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON-encoded arguments string from the provider. */
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Plain text, or a multimodal part list (text + redacted images). */
  content: string | ContentPart[];
  /** Assistant turn: the tool calls the model emitted (OpenAI `tool_calls`). */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** Tool turn: which assistant tool call this message answers. */
  tool_call_id?: string;
}

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Result of a tool-calling completion: free text and/or a batch of tool calls. */
export interface ToolCompletion {
  text: string;
  toolCalls: ToolCall[];
}

export interface CompleteOptions {
  model?: string;
  temperature?: number;
  /** When true, ask the provider for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
  /**
   * Base64 `data:` URLs to attach to the user message as image parts (vision).
   * MUST already be redacted — no card/PII pixels (redact.ts enforces this).
   */
  images?: string[];
  /** Abort the request after this many ms. Overrides LLM_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Default per-request LLM timeout. A hung request must never stall a whole run. */
const DEFAULT_LLM_TIMEOUT_MS = 60_000;

function resolveTimeoutMs(options: CompleteOptions): number {
  if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) return options.timeoutMs;
  const env = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_LLM_TIMEOUT_MS;
}

/**
 * Single chat completion. Returns the assistant message text.
 * Throws on non-2xx after surfacing the provider error body.
 */
export async function complete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string> {
  // Route the page-action loop to Gemini when configured; otherwise OpenRouter.
  if (getLlmProvider() === "gemini") {
    return geminiComplete(messages, options);
  }

  const apiKey = getOpenRouterKey();
  const model = options.model ?? getAgentModel();

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.json) body.response_format = { type: "json_object" };

  // Bound every request so a hung connection can't stall the whole checkout loop.
  const timeoutMs = resolveTimeoutMs(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/kar69-96/agentbuy",
        "X-Title": "tomo-buy",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter returned no content");
  }
  return content;
}

/**
 * Tool-calling completion. Posts `messages` plus the available `tools` in the
 * OpenAI-compatible function-calling format (which OpenRouter normalizes for
 * Claude and other providers), and returns the assistant's free text plus any
 * tool calls it emitted.
 *
 * SECURITY: the caller must never put a card number, password, session token,
 * or OTP into a message or tool result — only sanitized page state, %var%
 * names, and non-secret tool outputs. Redacted screenshots attach as image
 * parts on the messages exactly as in `complete()`.
 */
export async function completeWithTools(
  messages: ChatMessage[],
  tools: ToolDef[],
  options: CompleteOptions = {},
): Promise<ToolCompletion> {
  const apiKey = getOpenRouterKey();
  const model = options.model ?? getAgentModel();

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0,
    tools: tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
    tool_choice: "auto",
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;

  const timeoutMs = resolveTimeoutMs(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/kar69-96/agentbuy",
        "X-Title": "tomo-buy",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const msg = data.choices?.[0]?.message;
  return parseToolCompletion(msg);
}

/**
 * Map a raw OpenAI-style assistant message into a {@link ToolCompletion}. Pure
 * and exported so the parsing is unit-testable without a network call. Tolerates
 * a missing id/name (skips malformed calls) and a null content.
 */
export function parseToolCompletion(msg: unknown): ToolCompletion {
  const m = (msg ?? {}) as {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  const text = typeof m.content === "string" ? m.content : "";
  const toolCalls: ToolCall[] = [];
  for (const tc of m.tool_calls ?? []) {
    const name = tc.function?.name;
    if (!name) continue;
    toolCalls.push({
      id: tc.id ?? `call_${toolCalls.length}`,
      name,
      arguments: tc.function?.arguments ?? "{}",
    });
  }
  return { text, toolCalls };
}

/**
 * Parse a tool call's raw `arguments` JSON into an object. Returns `{}` on any
 * malformed/empty payload (weaker models occasionally emit invalid JSON), so a
 * tool executor always receives an object.
 */
export function parseToolArgs(call: ToolCall): Record<string, unknown> {
  const raw = (call.arguments ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Convenience: system + user → text. Attaches redacted images when provided. */
export function completePrompt(
  system: string,
  user: string,
  options: CompleteOptions = {},
): Promise<string> {
  // When images are present the user turn becomes a multimodal part list:
  // the text first, then one image_url block per (already-redacted) data URL.
  const userContent: string | ContentPart[] = options.images?.length
    ? [
        { type: "text", text: user },
        ...options.images.map(
          (url): ImagePart => ({ type: "image_url", image_url: { url } }),
        ),
      ]
    : user;

  return complete(
    [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    options,
  );
}

/**
 * Extract the first JSON value from a model response (handles ```json fences
 * and leading/trailing prose). Returns null if nothing parseable is found.
 */
export function parseJsonFromText<T = unknown>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  // Try the whole candidate first, then the first {...} or [...] block.
  const attempts = [candidate];
  const obj = candidate.match(/\{[\s\S]*\}/);
  const arr = candidate.match(/\[[\s\S]*\]/);
  if (obj) attempts.push(obj[0]);
  if (arr) attempts.push(arr[0]);
  for (const a of attempts) {
    try {
      return JSON.parse(a.trim()) as T;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Ask for structured JSON and parse it, retrying once with a stricter nudge.
 */
export async function completeJson<T = unknown>(
  system: string,
  user: string,
  options: CompleteOptions = {},
): Promise<T | null> {
  const opts = { ...options, json: true };
  const first = await completePrompt(system, user, opts);
  const parsed = parseJsonFromText<T>(first);
  if (parsed !== null) return parsed;

  const retry = await completePrompt(
    system,
    `${user}\n\nReturn ONLY valid JSON. No prose, no code fences.`,
    opts,
  );
  return parseJsonFromText<T>(retry);
}
