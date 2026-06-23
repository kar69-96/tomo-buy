/**
 * @tomo/vaults — Vault A (agent secrets) + Vault B (user PII).
 *
 * Prime directive: neither vault ever returns data into LLM context. Vault A is
 * read only by the Executor at login; Vault B releases ONE field at a time to the
 * Executor at fill time, logging each release. Everything is encrypted at rest
 * (AES-256-GCM via crypto.ts).
 */

export { encrypt, decrypt, deriveKey, type EncryptedBlob } from './crypto.js';
export { type VaultStore, InMemoryStore, EncryptedFileStore, selectStore } from './store.js';
export { AuditLog, type AuditEntry } from './audit.js';
export { VaultA } from './vault-a.js';
export { VaultB } from './vault-b.js';
