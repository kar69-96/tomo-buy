// ---- Phase 1: Session + Fetcher + SPA ----

export {
  createSessionState,
  addCookiesFromHeaders,
  setCsrfToken,
  setAuthToken,
  setCustomHeader,
  buildRequestHeaders,
  getCookieValue,
  parseSetCookieHeader,
} from "./session-manager.js";

export { fetchPage } from "./page-fetcher.js";
export type { FetchOptions, FetchPageResult } from "./page-fetcher.js";

export { scoreSpa } from "./spa-scorer.js";

export type {
  SessionState,
  CookieEntry,
  FetchResult,
  RedirectEntry,
  SpaScore,
  SpaSignalResult,
  PageSnapshot,
  FormField,
  ParsedForm,
  ExecutionContext,
  StepResult,
} from "./types.js";

// ---- Phase 2: Parser + Classifier + Profile Cache + Fingerprint ----

export { parseHTML } from "./page-parser.js";
export { classifyPage } from "./page-classifier.js";
export { loadProfile, saveProfile, isProfileStale, invalidateProfile } from "./profile-cache.js";
export { generateFingerprint, compareFingerprints, isFingerprintStale } from "./fingerprint.js";
export { extractValue } from "./value-extractor.js";

// ---- Phase 3: Payload + Stripe + Error Handler + Flow Executor + Runner ----

export { buildPayload } from "./payload-builder.js";
export { createPaymentMethod, confirmPaymentIntent } from "./stripe-client.js";
export { analyzeError, analyzeNullExtraction } from "./error-handler.js";
export { executeFlow } from "./flow-executor.js";
export type { FlowExecutionResult } from "./flow-executor.js";
export { runHTTPCheckout } from "./run-http-checkout.js";
export type { HTTPCheckoutInput, HTTPCheckoutResult } from "./run-http-checkout.js";

// ---- Phase 4: Engine Selection + Bot Detection ----

export { selectEngine } from "./engine-selector.js";
export type { EngineChoice } from "./engine-selector.js";
export { detectBotProtection } from "./bot-detector.js";

// ---- Phase 5: HTTP Walker + Live Integration ----

export { detectPlatform } from "./platform-detector.js";
export { mapFields } from "./field-mapper.js";
export { renderPage } from "./browser-renderer.js";
export type { RenderedPage } from "./browser-renderer.js";
export { buildProfile } from "./profile-builder.js";
export type { WalkerTrace, TraceStep } from "./profile-builder.js";
export { walkCheckoutFlow } from "./http-walker.js";
export type { WalkerInput, WalkerResult } from "./http-walker.js";
