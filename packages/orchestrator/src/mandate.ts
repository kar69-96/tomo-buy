/**
 * Ed25519 approval-mandate signing — a faithful port of AgentPay's
 * `auth/mandate.ts` + `auth/keypair.ts`, adapted for Tomo-buy (amounts in cents,
 * mandate bound to the exact TaskIntent via an intent hash for replay resistance).
 *
 * Uses Node's built-in `node:crypto` only — zero external crypto dependencies.
 *
 * SECRET-FLOW RULE: the private key is PKCS8/AES-256-CBC-encrypted and only ever
 * decrypted here at signing time with a passphrase supplied trusted-side. The
 * mandate carries only the public key + signature; no PAN/CVV/password is touched.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import type { TaskIntent } from '@tomo/core';

/** An asymmetric keypair, PEM-encoded (SPKI public, encrypted PKCS8 private). */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * The canonical, signed approval payload. Binds an approval to the exact
 * merchant + amount + cart (`intentHash`) + moment (`timestamp`). Any change to
 * these fields invalidates the signature, which is what makes a mandate
 * replay-resistant: it can only ever vouch for the one approval it was minted for.
 */
export interface ApprovalDetails {
  /** Workflow/transaction id this approval authorizes. */
  txId: string;
  /** Routed merchant id — must match the merchant the order is placed against. */
  merchant: string;
  /** Approved total in CENTS (never dollars). */
  amountCents: number;
  /** SHA-256 of the canonical TaskIntent — binds the mandate to the exact cart. */
  intentHash: string;
  /** ISO-8601 mint time; part of the signed payload for freshness/replay checks. */
  timestamp: string;
}

/** A signed approval mandate. Carries no secret — only a signature + public key. */
export interface ApprovalMandate {
  txId: string;
  /** SHA-256 (hex) of the canonical ApprovalDetails — the bytes that were signed. */
  detailsHash: string;
  /** Base64 Ed25519 signature over `detailsHash`. */
  signature: string;
  /** PEM SPKI public key that verifies `signature`. */
  publicKey: string;
  /** ISO-8601 mint time (mirrors the signed `ApprovalDetails.timestamp`). */
  timestamp: string;
}

/**
 * Generate an Ed25519 keypair. The private key is encrypted at rest with
 * AES-256-CBC under `passphrase` (PKCS8 PEM); the public key is SPKI PEM.
 */
export function generateKeyPair(passphrase: string): KeyPair {
  if (!passphrase) throw new Error('A passphrase is required to protect the private key.');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase,
    },
  });
  return { publicKey, privateKey };
}

/** Canonical SHA-256 (hex) of a TaskIntent — order-stable so it never drifts. */
export function hashIntent(intent: TaskIntent): string {
  const canonical = JSON.stringify({
    merchant_id: intent.merchant_id,
    cart_spec: intent.cart_spec,
    price_ceiling_cents: intent.price_ceiling_cents,
    account_bound: intent.account_bound,
    ship_to_ref: intent.ship_to_ref,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Canonical SHA-256 (hex) of the approval payload. */
function hashApprovalDetails(details: ApprovalDetails): string {
  const canonical = JSON.stringify({
    txId: details.txId,
    merchant: details.merchant,
    amountCents: details.amountCents,
    intentHash: details.intentHash,
    timestamp: details.timestamp,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Sign an approval. Decrypts the private key with `passphrase`, signs the
 * canonical details hash, and returns a self-verifying mandate.
 */
export function createMandate(
  details: ApprovalDetails,
  privateKeyPem: string,
  passphrase: string,
): ApprovalMandate {
  const detailsHash = hashApprovalDetails(details);
  const data = Buffer.from(detailsHash);

  const privateKey = createPrivateKey({
    key: privateKeyPem,
    format: 'pem',
    type: 'pkcs8',
    passphrase,
  });

  const signature = sign(null, data, privateKey);
  const publicKeyPem = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'pem',
  }) as string;

  return {
    txId: details.txId,
    detailsHash,
    signature: signature.toString('base64'),
    publicKey: publicKeyPem,
    timestamp: details.timestamp,
  };
}

/**
 * Verify a mandate against the details it should authorize. Returns `false`
 * (never throws) on any mismatch: tampered amount/merchant/intent, a forged or
 * bit-flipped signature, or the wrong public key. A mandate minted for one
 * approval cannot validate a different one — the hash won't match.
 */
export function verifyMandate(mandate: ApprovalMandate, details: ApprovalDetails): boolean {
  try {
    const detailsHash = hashApprovalDetails(details);
    if (detailsHash !== mandate.detailsHash) return false;

    const data = Buffer.from(detailsHash);
    const signature = Buffer.from(mandate.signature, 'base64');
    const publicKey = createPublicKey({
      key: mandate.publicKey,
      format: 'pem',
      type: 'spki',
    });
    return verify(null, data, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Freshness gate for replay defence in the time dimension: a structurally valid
 * mandate older than `maxAgeMs` is rejected. Pure (caller supplies `nowMs`).
 */
export function isMandateFresh(mandate: ApprovalMandate, nowMs: number, maxAgeMs: number): boolean {
  const minted = Date.parse(mandate.timestamp);
  if (Number.isNaN(minted)) return false;
  const age = nowMs - minted;
  return age >= 0 && age <= maxAgeMs;
}
