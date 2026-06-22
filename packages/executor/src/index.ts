/**
 * @tomo/executor — the trusted-side secret injector.
 *
 * The ONLY component that opens a secret (PAN/CVV, PII field, agent password) and
 * injects it into a page. The LLM/agent sees only `%var%` placeholders; real
 * values are assembled trusted-side, swapped into the DOM for milliseconds via
 * the verbatim atomic-swap script, and never returned, logged, or transcribed.
 * Checkout returns flags + non-secret status only. (Prime directive.)
 */

export { Executor } from './executor.js';
export type {
  ExecutorResult,
  ExecutorDeps,
  CheckoutParams,
  GetCardSecret,
  ReleasingVaultB,
} from './executor.js';
export type { BrowserDriver, FieldDescriptor } from './browser/driver.js';
export { PlaywrightDriver } from './browser/playwright-driver.js';
export {
  assertAmountWithinCeiling,
  assertShipToFromVault,
  assertMerchantMatches,
  surfaceInstructions,
  type Address,
} from './guardrails.js';
export {
  PLACEHOLDER_MAP,
  getPlaceholderVariables,
  credentialsToSwapMap,
  getAtomicSwapScript,
  type BillingCredentials,
} from './placeholder.js';
