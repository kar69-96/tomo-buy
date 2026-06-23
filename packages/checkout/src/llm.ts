/**
 * OpenRouter chat client (fetch-based, no SDK dependency).
 *
 * Replaces the Gemini / Stagehand-internal LLM. Every model call in checkout and
 * discovery goes through here. Card numbers MUST NEVER be passed to these
 * functions — only sanitized page text, instructions, and %var% placeholders.
 */

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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  model?: string;
  temperature?: number;
  /** When true, ask the provider for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
}

/**
 * Single chat completion. Returns the assistant message text.
 * Throws on non-2xx after surfacing the provider error body.
 */
export async function complete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string> {
  const apiKey = getOpenRouterKey();
  const model = options.model ?? getAgentModel();

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.json) body.response_format = { type: "json_object" };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/kar69-96/agentbuy",
      "X-Title": "tomo-buy",
    },
    body: JSON.stringify(body),
  });

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

/** Convenience: system + user → text. */
export function completePrompt(
  system: string,
  user: string,
  options: CompleteOptions = {},
): Promise<string> {
  return complete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
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
