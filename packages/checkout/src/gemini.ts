/**
 * Google Gemini chat client (fetch-based, no SDK dependency).
 *
 * This is the production-recommended in-checkout browser agent (see README:
 * "Recommended tooling"). It is wired behind the same `complete()` contract as
 * the OpenRouter client so the page-action loop is provider-agnostic; selection
 * happens in llm.ts via getLlmProvider().
 *
 * Stub status: the request/response mapping is real and the call works against
 * the Gemini REST API, but it has not been exercised end-to-end against a live
 * checkout. It stays dormant unless LLM_PROVIDER=gemini AND GEMINI_API_KEY are
 * both set; otherwise the OpenRouter client handles everything.
 *
 * PRIME DIRECTIVE: card numbers / passwords / session tokens MUST NEVER be
 * passed here — only sanitized page text, instructions, and %var% placeholders.
 */

import { getGeminiKey, getGeminiModel } from "@tomo/core";
import type { ChatMessage, CompleteOptions } from "./llm.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig: {
    temperature: number;
    responseMimeType?: "application/json";
    maxOutputTokens?: number;
  };
}

/**
 * Map OpenAI-style chat messages to Gemini's request body (pure / testable).
 *
 * Gemini separates the system prompt (`systemInstruction`) from the turn list
 * and uses "model" rather than "assistant" for prior completions.
 */
export function buildGeminiRequest(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): GeminiRequest {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();

  const contents: GeminiContent[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const request: GeminiRequest = {
    contents,
    generationConfig: { temperature: options.temperature ?? 0 },
  };
  if (systemText) request.systemInstruction = { parts: [{ text: systemText }] };
  if (options.json) request.generationConfig.responseMimeType = "application/json";
  if (options.maxTokens) request.generationConfig.maxOutputTokens = options.maxTokens;

  return request;
}

/** Pull the assistant text out of a Gemini generateContent response (pure). */
export function parseGeminiResponse(data: unknown): string {
  const d = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

/**
 * Single chat completion via Gemini. Mirrors llm.ts `complete()` so callers
 * never branch on the provider. Throws on non-2xx after surfacing the error.
 */
export async function geminiComplete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string> {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is required when LLM_PROVIDER=gemini. Get one at https://aistudio.google.com/apikey",
    );
  }
  const model = options.model ?? getGeminiModel();
  const url = `${GEMINI_BASE}/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(buildGeminiRequest(messages, options)),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 300)}`);
  }

  return parseGeminiResponse(await res.json());
}
