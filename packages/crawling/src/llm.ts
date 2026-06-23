/**
 * OpenRouter chat client for the crawling package (fetch-based, no SDK).
 *
 * crawling cannot import from @tomo/checkout (checkout depends on crawling), so
 * this mirrors checkout/src/llm.ts. Used for structured product extraction from
 * rendered page markdown — replaces the old Gemini path.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterKey(): string | null {
  return process.env.OPENROUTER_API_KEY ?? null;
}

export function getExtractModel(): string {
  return (
    process.env.INTENT_MODEL ||
    process.env.AGENT_MODEL ||
    "openai/gpt-4o-mini"
  );
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  model?: string;
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function complete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");

  const body: Record<string, unknown> = {
    model: options.model ?? getExtractModel(),
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
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter returned no content");
  return content;
}

export function parseJsonFromText<T = unknown>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : raw;
  const attempts = [candidate];
  const obj = candidate.match(/\{[\s\S]*\}/);
  if (obj) attempts.push(obj[0]);
  for (const a of attempts) {
    try {
      return JSON.parse(a.trim()) as T;
    } catch {
      // try next
    }
  }
  return null;
}

export async function completeJson<T = unknown>(
  system: string,
  user: string,
  options: CompleteOptions = {},
): Promise<T | null> {
  const raw = await complete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { ...options, json: true },
  );
  return parseJsonFromText<T>(raw);
}
