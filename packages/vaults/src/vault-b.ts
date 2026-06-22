import type { VaultB as VaultBContract, PiiField } from '@tomo/core';
import { VaultError, PiiFieldSchema } from '@tomo/core';
import type { VaultStore } from './store.js';
import { encrypt, decrypt } from './crypto.js';
import { AuditLog } from './audit.js';

/**
 * Vault B — user PII with strict field-level access control. Each field is stored
 * as its own encrypted record (`b:<user>:<field>`), so there is no structural way
 * to bulk-read a user's PII: `releaseField` returns exactly one field and appends
 * exactly one audit entry. There is no "give me everything" call — ever.
 *
 * Deletion path: `deleteUser` drops every encrypted record for the user. Because
 * the records were the only copies of the ciphertext, removing them is a
 * cryptographic erasure of that PII.
 */
export class VaultB implements VaultBContract {
  private readonly audit: AuditLog;

  constructor(
    private readonly store: VaultStore,
    private readonly masterKey: string,
    audit?: AuditLog,
  ) {
    this.audit = audit ?? new AuditLog();
  }

  private key(user: string, field: PiiField): string {
    return `b:${user}:${field}`;
  }

  /** Provision a single PII field (write). Not a release — not audited. */
  async setField(user: string, field: PiiField, value: string): Promise<void> {
    const f = PiiFieldSchema.parse(field);
    await this.store.put(this.key(user, f), encrypt(value, this.masterKey));
  }

  /** Provision multiple PII fields at once (write). Not a release — not audited. */
  async setRecord(user: string, record: Partial<Record<PiiField, string>>): Promise<void> {
    for (const [field, value] of Object.entries(record)) {
      if (value !== undefined) {
        await this.setField(user, field as PiiField, value);
      }
    }
  }

  /**
   * Executor-only, logged. Returns a single PII field value and appends exactly
   * one audit entry. Throws VaultError if the field is not set for this user.
   */
  async releaseField(
    user: string,
    field: PiiField,
    requester = 'executor:checkout',
  ): Promise<string> {
    const f = PiiFieldSchema.parse(field);
    const blob = await this.store.get(this.key(user, f));
    if (!blob) {
      throw new VaultError(`Vault B has no '${f}' for user ${user}.`);
    }
    const value = decrypt(blob, this.masterKey);
    this.audit.record(user, f, requester, new Date().toISOString());
    return value;
  }

  /** Cryptographic deletion: remove all PII records for the user. Returns count removed. */
  async deleteUser(user: string): Promise<number> {
    return this.store.deletePrefix(`b:${user}:`);
  }

  /** Read-only access to the audit log (no secret values). */
  auditLog(): AuditLog {
    return this.audit;
  }
}
