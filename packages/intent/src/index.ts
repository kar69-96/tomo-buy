/**
 * @tomo/intent — the intent parser (INTENT-ONLY).
 *
 * `parseIntent(userId, text)` calls an LLM (OpenRouter by default, injectable)
 * to extract merchant + cart + price, then derives the safety-critical
 * `account_bound` flag and the `ship_to_ref` reference trusted-side and validates
 * the whole thing against `TaskIntentSchema`. It never emits a path/lane and never
 * carries a secret or address.
 */
export {
  parseIntent,
  detectAccountBound,
  resolveCeiling,
  DEFAULT_PRICE_CEILING_CENTS,
} from './parse.js';
export type { ParseDeps, ParseResult, CompleteFn } from './parse.js';
export { SYSTEM_PROMPT } from './prompt.js';
