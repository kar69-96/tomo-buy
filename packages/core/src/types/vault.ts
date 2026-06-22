import type { PiiField, AgentCredential } from '../schemas/vault.js';

export type { PiiField, AgentCredential } from '../schemas/vault.js';

/**
 * Vault A — agent secrets (generated credentials). Written once, read only by
 * the Executor at login. Never bulk-read into LLM context.
 */
export interface VaultA {
  /** Executor-only. Returns the agent credential for this (user, merchant). */
  read(user: string, merchant: string): Promise<AgentCredential>;
}

/**
 * Vault B — user PII (name, address, email-of-record, phone). Field-level
 * release: the Executor requests ONE field at fill time and the release is
 * logged. There is NO bulk read into model context — ever.
 */
export interface VaultB {
  /** Executor-only, logged. Returns a single PII field value. */
  releaseField(user: string, field: PiiField): Promise<string>;
}
