import dotenv from "dotenv";
import type {
  CardInfo,
  BillingInfo,
  ShippingInfo,
  TomoConfig,
} from "./types.js";
import { getConfig, saveConfig } from "./store.js";

dotenv.config();

// ---- Typed accessors ----

export function getPort(): number {
  return Number(process.env.PORT) || 3000;
}

// ---- Funding mode ----

export type FundingMode = "agentcard" | "static";

/**
 * How checkout is funded:
 * - "agentcard" (default): issue a single-use Agentcard card per purchase.
 * - "static": use the static card from .env (debugging only).
 */
export function getFundingMode(): FundingMode {
  return process.env.FUNDING === "static" ? "static" : "agentcard";
}

/** Buffer over the item price to cover tax/shipping (default 15%). */
export function getAgentcardBufferPct(): number {
  const v = Number(process.env.AGENTCARD_BUFFER_PCT);
  return Number.isFinite(v) && v >= 0 ? v : 0.15;
}

/** Hard ceiling (dollars) on any single issued card (default $500). */
export function getAgentcardMaxAmount(): number {
  const v = Number(process.env.AGENTCARD_MAX_AMOUNT);
  return Number.isFinite(v) && v > 0 ? v : 500;
}

// ---- Identity / vault / planner ----

/**
 * Symmetric key used to encrypt the local secret vault (~/.tomo/vault.json).
 * Returns null when unset; the vault fails fast (VAULT_LOCKED) only when a
 * secret is actually requested, so card-only flows never need it.
 */
export function getVaultKey(): string | null {
  return process.env.VAULT_KEY || null;
}

/**
 * Composio API key (optional). When set, the real Gmail client is used to read
 * the user's connected inbox (existing-account evidence + one-time codes); when
 * unset, the stub returns nothing and the resolver defaults to an agent identity.
 */
export function getComposioKey(): string | null {
  return process.env.COMPOSIO_API_KEY || null;
}

/**
 * No-spend oversight checkpoint: stop the checkout loop as soon as login has
 * advanced, before driving cart/payment. Used to exercise (and assert) the login
 * gate in isolation. Generic across sites — keys on the login executor's
 * "advanced" signal, never on a domain. Implies a no-spend run.
 */
export function getStopAfterLogin(): boolean {
  return process.env.LOGIN_CHECKPOINT === "1";
}

// ---- Browser runtime ----

export type BrowserRuntime = "local" | "browserbase";

/**
 * Where checkout/discovery browsers run:
 * - "local" (default): local Playwright Chrome — runs out of the box.
 * - "browserbase": managed stealth browsers (the production-recommended runtime).
 *   Falls back to "local" unless BROWSERBASE_API_KEY is also set.
 */
export function getBrowserRuntime(): BrowserRuntime {
  const wantsBrowserbase = process.env.BROWSER_RUNTIME === "browserbase";
  return wantsBrowserbase && getBrowserbaseKey() ? "browserbase" : "local";
}

/** Browserbase API key (optional; the runtime is stubbed until wired). */
export function getBrowserbaseKey(): string | null {
  return process.env.BROWSERBASE_API_KEY || null;
}

/** Browserbase project id (required by the session-create API). */
export function getBrowserbaseProjectId(): string | null {
  return process.env.BROWSERBASE_PROJECT_ID || null;
}

// ---- In-checkout LLM provider ----

export type LlmProvider = "openrouter" | "gemini";

/**
 * Which provider backs the in-checkout browser agent (action selection):
 * - "openrouter" (default): OpenRouter — runs out of the box.
 * - "gemini": Google Gemini (the production-recommended in-checkout agent).
 *   Falls back to "openrouter" unless GEMINI_API_KEY is also set.
 *
 * Discovery/extraction and the planner stay on OpenRouter regardless; this
 * only routes the page-action loop. Card data NEVER reaches either provider.
 */
export function getLlmProvider(): LlmProvider {
  const wantsGemini = process.env.LLM_PROVIDER === "gemini";
  return wantsGemini && getGeminiKey() ? "gemini" : "openrouter";
}

/** Gemini API key (optional; the client is stubbed until wired). */
export function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

/**
 * Model id for the native Gemini in-checkout agent. Defaults to 2.5 Flash-Lite —
 * vision-capable and cheaper than gpt-4o-mini. (The old gemini-2.0-flash default
 * was retired by Google on 2026-06-01.)
 */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
}

/** Model for the planning agent; defaults to the discovery/intent model. */
export function getPlannerModel(): string {
  return (
    process.env.PLANNER_MODEL ||
    process.env.INTENT_MODEL ||
    process.env.AGENT_MODEL ||
    "openai/gpt-4o-mini"
  );
}

// ---- Credential accessors ----

export function getCardInfo(): CardInfo {
  return {
    number: process.env.CARD_NUMBER || "",
    expiry: process.env.CARD_EXPIRY || "",
    cvv: process.env.CARD_CVV || "",
    cardholder_name: process.env.CARDHOLDER_NAME || "",
  };
}

export function getBillingInfo(): BillingInfo {
  return {
    street: process.env.BILLING_STREET || "",
    city: process.env.BILLING_CITY || "",
    state: process.env.BILLING_STATE || "",
    zip: process.env.BILLING_ZIP || "",
    country: process.env.BILLING_COUNTRY || "",
  };
}

export function getDefaultShipping(): ShippingInfo | undefined {
  if (!process.env.SHIPPING_NAME) return undefined;
  return {
    name: process.env.SHIPPING_NAME,
    street: process.env.SHIPPING_STREET || "",
    city: process.env.SHIPPING_CITY || "",
    state: process.env.SHIPPING_STATE || "",
    zip: process.env.SHIPPING_ZIP || "",
    country: process.env.SHIPPING_COUNTRY || "",
    email: process.env.SHIPPING_EMAIL || "",
    phone: process.env.SHIPPING_PHONE || "",
  };
}

// ---- Config management ----

export function loadConfig(): TomoConfig {
  const existing = getConfig();
  if (existing) return existing;

  const config: TomoConfig = {
    default_order_expiry_seconds: 300,
    port: getPort(),
  };

  saveConfig(config);
  return config;
}
