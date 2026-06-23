import type { CompleteFn } from './parse.js';

/**
 * Default model client: a single OpenRouter chat-completion call over native
 * fetch. Returns the raw assistant text (expected to be JSON); parse/validation
 * happens in `parseIntent`. No `ai` SDK dependency, so no zod-version conflict.
 *
 * Configured purely from env (the user pastes `.env` separately):
 *   OPENROUTER_API_KEY  — required
 *   INTENT_MODEL        — model slug; defaults to a cheap model
 *
 * This file is network-only and excluded from coverage; all parsing logic that
 * needs testing lives in `parse.ts`.
 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-3.1-8b-instruct';

export const defaultComplete: CompleteFn = async (system, user) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'intent parser: OPENROUTER_API_KEY is not set; cannot call the model',
    );
  }
  const model = process.env.INTENT_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(
      `intent parser: OpenRouter request failed with status ${res.status}`,
    );
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('intent parser: OpenRouter returned no message content');
  }
  return content;
};
