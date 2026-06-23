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

/** Composio API key (optional; the client is stubbed until wired). */
export function getComposioKey(): string | null {
  return process.env.COMPOSIO_API_KEY || null;
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
