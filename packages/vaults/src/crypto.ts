import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { VaultError } from '@tomo/core';

/**
 * Authenticated encryption for data at rest. Ported from AgentPay
 * (useagentpay-x402/packages/sdk/src/vault/vault.ts): AES-256-GCM with a
 * PBKDF2-SHA512 key derivation (100k iterations). Generalized here to operate on
 * an arbitrary UTF-8 string so it can wrap any vault record (agent credential or
 * a single PII field), not just AgentPay's BillingCredentials shape.
 *
 * Secret-flow note: this module only ever returns ciphertext or the exact
 * plaintext the caller put in. It never logs and never widens scope.
 */

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/** An encrypted blob: ciphertext (with appended GCM auth tag), salt, and IV — all base64. */
export interface EncryptedBlob {
  ciphertext: string;
  salt: string;
  iv: string;
}

/** PBKDF2-SHA512 key derivation. Same parameters as the AgentPay vault. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/** Encrypt a UTF-8 plaintext with a passphrase. Returns base64 ciphertext+salt+iv. */
export function encrypt(plaintext: string, passphrase: string): EncryptedBlob {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt a blob produced by `encrypt`. Throws `VaultError` on a wrong passphrase
 * or any tampering (GCM auth-tag mismatch) — failures never leak which check
 * failed, only that decryption was rejected.
 */
export function decrypt(blob: EncryptedBlob, passphrase: string): string {
  try {
    const salt = Buffer.from(blob.salt, 'base64');
    const iv = Buffer.from(blob.iv, 'base64');
    const data = Buffer.from(blob.ciphertext, 'base64');
    const key = deriveKey(passphrase, salt);

    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString('utf8');
  } catch {
    throw new VaultError('Vault decryption failed (wrong passphrase or tampered ciphertext).');
  }
}
