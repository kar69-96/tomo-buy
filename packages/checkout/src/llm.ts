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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** Plain text, or a multimodal part list (text + redacted images). */
  content: string | ContentPart[];
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
