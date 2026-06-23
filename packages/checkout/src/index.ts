// ---- Checkout orchestration ----
export { runCheckout, CHECKOUT_STEPS } from "./task.js";
export type { CheckoutResult, CheckoutInput, CheckoutStep, CheckoutCheckpoints } from "./task.js";

// ---- CAPTCHA handling ----
export { waitForCaptchaSolve } from "./captcha.js";

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

// Re-export Firecrawl discovery from @bloon/crawling
export { discoverViaFirecrawl } from "@bloon/crawling";
export type { FullDiscoveryResult } from "@bloon/crawling";

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
  getBrowserbaseConfig,
  getModelApiKey,
  getQueryModelApiKey,
  getAnthropicApiKey,
} from "./session.js";
export type { BrowserbaseSession, SessionOptions } from "./session.js";

// ---- Domain cache ----
export {
  extractDomainCache,
  injectDomainCache,
  loadDomainCache,
  saveDomainCache,
  isSafeCookie,
  extractDomain,
} from "./cache.js";

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
  scriptedSelectOption,
  scriptedFillVerificationCode,
  detectPageType,
  extractConfirmationData,
  extractVisibleTotal,
  extractErrorMessage,
} from "./scripted-actions.js";
export type { PageType, ConfirmationData, ErrorData, ErrorType } from "./scripted-actions.js";


// ---- AgentMail (email verification) ----
export {
  getOrCreateInbox,
  getAgentEmail,
  pollForVerificationCode,
  resetAgentMail,
} from "./agentmail.js";

// ---- Agent tools (includes iframe scanner) ----
export { scanIframesForCardFields } from "./agent-tools.js";
