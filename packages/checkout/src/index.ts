// ---- Checkout orchestration ----
export { runCheckout, CHECKOUT_STEPS } from "./task.js";
export type { CheckoutResult, CheckoutInput, CheckoutStep, CheckoutCheckpoints } from "./task.js";

// ---- CAPTCHA handling ----
export { waitForCaptchaSolve, isChallengePage, waitForHumanToSolveChallenge } from "./captcha.js";

// ---- Price discovery ----
export {
  discoverPrice,
  scrapePrice,
  discoverViaCart,
  extractJsonLd,
  extractMetaTag,
  discoverProduct,
  scrapePriceWithOptions,
  discoverViaBrowser,

  extractVariantsFromJsonLd,
  fetchVariantPriceBrowser,
  resolveVariantPricesViaBrowser,
  sanitizeVariantValue,
  dismissPopupsOnPage,
} from "./discover.js";
export type {
  DiscoveryResult,
  DiscoveryResultWithOptions,
} from "./discover.js";

// Re-export Firecrawl discovery from @tomo/crawling
export { discoverViaFirecrawl } from "@tomo/crawling";
export type { FullDiscoveryResult } from "@tomo/crawling";

// ---- Concurrency pool ----
export { concurrencyPool } from "./concurrency-pool.js";

// ---- Cost tracking ----
export { CostTracker } from "./cost-tracker.js";

// ---- Confirmation detection ----
export { verifyConfirmationPage } from "./confirm.js";
export type { ConfirmationResult } from "./confirm.js";

// ---- Credentials ----
export {
  buildCredentials,
  isCdpField,
  sanitizeShipping,
  getStagehandVariables,
  getCdpCredentials,
  formatPhone,
} from "./credentials.js";

// ---- Session management ----
export {
  createSession,
  destroySession,
  getOpenRouterKey,
} from "./session.js";
export type { BrowserSession, BrowserbaseSession, SessionOptions } from "./session.js";

// ---- Browserbase runtime (production-recommended; stubbed until wired) ----
export {
  createBrowserbaseSession,
  releaseBrowserbaseSession,
  buildSessionRequest,
  replayUrlFor,
} from "./browserbase-session.js";

// ---- Browserbase Agents checkout engine (primary when BROWSER_BACKEND=browserbase-agents) ----
export { runCheckoutViaBrowserbaseAgents } from "./browserbase-agents/engine.js";
export { buildAgentTask, assertNoCdpSecrets } from "./browserbase-agents/task-builder.js";
export type { AgentTaskSpec } from "./browserbase-agents/task-builder.js";
export { startRun, getRun } from "./browserbase-agents/client.js";
export type { AgentRun, AgentRunRequest, AgentRunStatus, AgentVariable } from "./browserbase-agents/client.js";
export { pollRun, isTerminal } from "./browserbase-agents/poll.js";
export { AGENT_RESULT_SCHEMA, AgentResultSchema } from "./browserbase-agents/result-schema.js";
export type { AgentResult } from "./browserbase-agents/result-schema.js";

// ---- Agentcard funding ----
export {
  issueCard,
  revealCard,
  read3dsCodes,
  issueAndRevealCard,
  preflight,
  parseCardId,
  parseCardDetails,
  parse3dsCodes,
} from "./agentcard.js";
export type { AgentcardPreflight } from "./agentcard.js";

// ---- Page actions (OpenRouter-driven) ----
export { playwrightAct } from "./act.js";
export type { ActOptions } from "./act.js";

// ---- Computer-Use Agent (tool-calling CUA loop + tool registry) ----
export { runCuaTask, SYSTEM as CUA_SYSTEM } from "./cua/loop.js";
export type { CuaParams, CuaResult, Observation } from "./cua/loop.js";
export { buildToolset } from "./cua/tools.js";
export type {
  CuaTool,
  ToolContext,
  ToolResult,
  CuaStatus,
  FinishResult,
  ShippingData as CuaShippingData,
} from "./cua/tools.js";

// ---- LLM (OpenRouter default; Gemini when LLM_PROVIDER=gemini) ----
export {
  complete,
  completePrompt,
  completeJson,
  completeWithTools,
  parseToolCompletion,
  parseToolArgs,
  parseJsonFromText,
  getAgentModel,
  getExtractModel,
} from "./llm.js";
export type {
  ChatMessage,
  CompleteOptions,
  ToolDef,
  ToolCall,
  ToolCompletion,
} from "./llm.js";

// ---- Gemini in-checkout agent (production-recommended; stubbed until wired) ----
export {
  geminiComplete,
  buildGeminiRequest,
  parseGeminiResponse,
} from "./gemini.js";
export type { GeminiRequest } from "./gemini.js";

// ---- Domain cache: debugging tooling (local Playwright, file-backed) ----
export {
  extractDomainCache,
  injectDomainCache,
  injectLocalStorage,
  loadDomainCache,
  saveDomainCache,
  isSafeCookie,
  extractDomain,
  getCacheDir,
} from "./cache.js";

// ---- Domain cache: ideal tooling (Browserbase Contexts; stubbed until wired) ----
export {
  loadContextId,
  saveContextId,
  loadContextMap,
  buildContextSetting,
  createRemoteContext,
  resolveContextId,
} from "./browserbase-cache.js";
export type { ContextSetting } from "./browserbase-cache.js";

// ---- Card fills ----
export {
  fillCardField,
  fillAllCardFields,
  mapFieldToCredential,
  scanAllFramesForCardFields,
} from "./fill.js";
export type { ObservedField } from "./fill.js";

// ---- Scripted actions (zero-LLM DOM manipulation) ----
export {
  scriptedDismissPopups,
  scriptedFillShipping,
  scriptedFillCardFields,
  scriptedFillBilling,
  scriptedUncheckBillingSameAsShipping,
  scriptedClickButton,
  scriptedClickSelector,
  scriptedSelectOption,
  scriptedFillVerificationCode,
  detectPageType,
  extractConfirmationData,
  extractVisibleTotal,
  extractErrorMessage,
} from "./scripted-actions.js";
export type {
  PageType,
  ConfirmationData,
  ErrorData,
  ErrorType,
  ShippingFillResult,
  CardFillResult,
  ClickMatch,
} from "./scripted-actions.js";

// ---- Per-site checkout skills (write + read-back) ----
export { SkillRecorder, dedupeSelectors, dedupeFlow } from "./skill-recorder.js";
export {
  loadSiteSkill,
  writeSiteSkill,
  mergeSiteSkill,
  buildSelectorHints,
  SelectorHints,
  findSkillRoot,
  sanitizeDomainForPath,
} from "./site-skill.js";
export { renderSkillMarkdown } from "./skill-renderer.js";
export { narrateLearnings, buildNarrationFacts } from "./skill-narrator.js";
export type { NarrationFacts } from "./skill-narrator.js";
export type {
  SiteSkillRecord,
  RecordedSelector,
  FieldProvenance,
  SkillActionKind,
  SkillMode,
  PageFlowEntry,
} from "./skill-types.js";
export { SITE_SKILL_SCHEMA, SKILL_DIR_NAME } from "./skill-types.js";


// ---- Login-gate execution (identity-driven) ----
export { executeLogin, seedSessionCookies } from "./login.js";
export type { LoginPlan, LoginResult, SessionCookie } from "./login.js";

// ---- AgentMail (email verification) ----
export {
  getOrCreateInbox,
  getAgentEmail,
  pollForVerificationCode,
  resetAgentMail,
} from "./agentmail.js";

// ---- Agent tools (includes iframe scanner) ----
export { scanIframesForCardFields } from "./agent-tools.js";

// ---- Checkout tracing (JSONL + screenshots; opt-in via CHECKOUT_TRACE_DIR) ----
export { CheckoutTracer, makeTracerFromEnv } from "./trace.js";
export type { TraceRecord, TraceMode } from "./trace.js";

// ---- Screenshot redaction (vision trust boundary) ----
export {
  captureRedactedScreenshot,
  isCardFieldIdent,
  isPaymentIframeSrc,
  filterPiiValues,
} from "./redact.js";
export type { RedactOptions } from "./redact.js";
