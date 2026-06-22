import { z } from 'zod';
import { TaskIntentSchema, CartSpecSchema } from '@tomo/core';
import type { TaskIntent } from '@tomo/core';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { defaultComplete } from './provider.js';

/** Conservative default spending ceiling when the user names no price ($50). */
export const DEFAULT_PRICE_CEILING_CENTS = 5000;

/** A model client: given system + user messages, returns raw assistant text. */
export type CompleteFn = (system: string, user: string) => Promise<string>;

/** Injectable dependencies. Defaults to the real OpenRouter call. */
export interface ParseDeps {
  complete: CompleteFn;
}

/**
 * The result of parsing. `intent` is schema-valid and carries references only —
 * never a secret, never a path/lane. `ceilingDefaulted` is true when the user
 * gave no price and the conservative default was applied; the approval gate uses
 * this to confirm the cap before any charge.
 */
export interface ParseResult {
  intent: TaskIntent;
  ceilingDefaulted: boolean;
}

/**
 * The raw shape the model is allowed to return. `.strict()` rejects any extra
 * field — so a model that tries to sneak in a `path`/`lane`/secret causes a hard
 * failure rather than silently passing untrusted data downstream.
 */
const RawIntentSchema = z
  .object({
    merchant_id: z.string().min(1),
    cart_spec: CartSpecSchema,
    price_ceiling_cents: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

/**
 * Phrases that signal the request is bound to the user's OWN existing account
 * ("my usual", "my credit", "reorder", …). Detected deterministically from the
 * original user text — NOT trusted to the model — because account_bound is a
 * safety-critical routing input.
 */
const ACCOUNT_BOUND_PATTERNS: readonly RegExp[] = [
  /\bmy usual\b/i,
  /\bthe usual\b/i,
  /\bmy credit\b/i,
  /\bmy points\b/i,
  /\bmy rewards\b/i,
  /\bmy saved\b/i,
  /\bmy account\b/i,
  /\bmy reservation\b/i,
  /\bmy (last|previous|recent) order\b/i,
  /\breorder\b/i,
  /\border again\b/i,
  /\bsame as last time\b/i,
];

/** True when the text references the user's own held account/order/credentials. */
export function detectAccountBound(text: string): boolean {
  return ACCOUNT_BOUND_PATTERNS.some((re) => re.test(text));
}

/**
 * Resolve the spending ceiling. Returns the user's value when present and valid,
 * otherwise the conservative default flagged via `defaulted`.
 */
export function resolveCeiling(raw: number | null | undefined): {
  cents: number;
  defaulted: boolean;
} {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return { cents: raw, defaulted: false };
  }
  return { cents: DEFAULT_PRICE_CEILING_CENTS, defaulted: true };
}

/**
 * `parseIntent(userId, text)` — turn a user prompt into a validated `TaskIntent`.
 *
 * INTENT-ONLY: the model extracts merchant + cart + price; it never chooses a
 * path/lane and never emits secrets. account_bound and ship_to_ref are derived
 * trusted-side, not from the model. The result is rejected unless it passes
 * `TaskIntentSchema`, so untrusted model output never escapes this function.
 */
export async function parseIntent(
  userId: string,
  text: string,
  deps: ParseDeps = { complete: defaultComplete },
): Promise<ParseResult> {
  if (userId.trim().length === 0) {
    throw new Error('parseIntent: userId is required');
  }
  if (text.trim().length === 0) {
    throw new Error('parseIntent: text is required');
  }

  const rawText = await deps.complete(SYSTEM_PROMPT, buildUserMessage(text));

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error('parseIntent: model returned non-JSON output');
  }

  // Untrusted until validated against the strict raw schema.
  const raw = RawIntentSchema.parse(parsedJson);

  const { cents, defaulted } = resolveCeiling(raw.price_ceiling_cents);

  // ship_to_ref is a Vault B reference derived from the user id — never an
  // address from the model. The Executor resolves it later.
  const candidate: TaskIntent = {
    merchant_id: raw.merchant_id,
    cart_spec: raw.cart_spec,
    price_ceiling_cents: cents,
    account_bound: detectAccountBound(text),
    ship_to_ref: `vaultB:${userId}:default`,
  };

  // Final boundary validation. Throws if anything is off.
  const intent = TaskIntentSchema.parse(candidate);

  return { intent, ceilingDefaulted: defaulted };
}
