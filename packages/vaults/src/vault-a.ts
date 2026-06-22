import type { VaultA as VaultAContract, AgentCredential } from '@tomo/core';
import { VaultError, AgentCredentialSchema } from '@tomo/core';
import type { VaultStore } from './store.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * Vault A — agent-minted secrets, one credential per (user, merchant). The agent
 * generates an account password, it is written ONCE here, and is read only by
 * the trusted-side Executor at login time. It never enters LLM context.
 *
 * Write-once: a credential cannot be overwritten (an accidental re-mint must not
 * silently clobber a working account). Encrypted at rest via crypto.ts.
 */
export class VaultA implements VaultAContract {
  constructor(
    private readonly store: VaultStore,
    private readonly masterKey: string,
  ) {}

  private key(user: string, merchant: string): string {
    return `a:${user}:${merchant}`;
  }

  /** Write-once. Throws VaultError if a credential already exists for (user, merchant). */
  async write(user: string, merchant: string, credential: AgentCredential): Promise<void> {
    const parsed = AgentCredentialSchema.parse(credential);
    const key = this.key(user, merchant);
    if (await this.store.has(key)) {
      throw new VaultError(`Vault A credential already exists for (${user}, ${merchant}).`);
    }
    await this.store.put(key, encrypt(JSON.stringify(parsed), this.masterKey));
  }

  /** Executor-only. Returns the agent credential for this (user, merchant). */
  async read(user: string, merchant: string): Promise<AgentCredential> {
    const blob = await this.store.get(this.key(user, merchant));
    if (!blob) {
      throw new VaultError(`Vault A has no credential for (${user}, ${merchant}).`);
    }
    return AgentCredentialSchema.parse(JSON.parse(decrypt(blob, this.masterKey)));
  }

  /** True if a credential exists (no secret returned). */
  async has(user: string, merchant: string): Promise<boolean> {
    return this.store.has(this.key(user, merchant));
  }
}
