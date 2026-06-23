import { describe, it, expect } from 'vitest';
import type { TaskIntent } from '@tomo/core';
import {
  generateKeyPair,
  createMandate,
  verifyMandate,
  hashIntent,
  isMandateFresh,
  type ApprovalDetails,
} from './mandate.js';

const passphrase = 'test-mandate-pass!';

const intent: TaskIntent = {
  merchant_id: 'merchant.example',
  cart_spec: { natural: '2x oat milk latte', items: [{ name: 'oat milk latte', qty: 2 }] },
  price_ceiling_cents: 2000,
  account_bound: false,
  ship_to_ref: 'vaultB:addr-1',
};

function baseDetails(overrides: Partial<ApprovalDetails> = {}): ApprovalDetails {
  return {
    txId: 'wf_abc123',
    merchant: 'merchant.example',
    amountCents: 1850,
    intentHash: hashIntent(intent),
    timestamp: '2026-06-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('generateKeyPair', () => {
  it('produces PEM-encoded SPKI public + encrypted PKCS8 private keys', () => {
    const keys = generateKeyPair(passphrase);
    expect(keys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(keys.privateKey).toContain('-----BEGIN ENCRYPTED PRIVATE KEY-----');
  });

  it('requires a passphrase', () => {
    expect(() => generateKeyPair('')).toThrow();
  });
});

describe('hashIntent', () => {
  it('is deterministic for the same intent', () => {
    expect(hashIntent(intent)).toBe(hashIntent({ ...intent }));
  });

  it('changes when the cart changes', () => {
    expect(hashIntent(intent)).not.toBe(hashIntent({ ...intent, price_ceiling_cents: 9999 }));
  });
});

describe('createMandate / verifyMandate', () => {
  it('round-trips: a freshly signed mandate verifies', () => {
    const keys = generateKeyPair(passphrase);
    const details = baseDetails();
    const mandate = createMandate(details, keys.privateKey, passphrase);
    expect(mandate.txId).toBe('wf_abc123');
    expect(mandate.signature.length).toBeGreaterThan(0);
    expect(verifyMandate(mandate, details)).toBe(true);
  });

  it('fails verification when the amount is tampered (replay onto a new cart)', () => {
    const keys = generateKeyPair(passphrase);
    const mandate = createMandate(baseDetails(), keys.privateKey, passphrase);
    expect(verifyMandate(mandate, baseDetails({ amountCents: 9999 }))).toBe(false);
  });

  it('fails verification when the merchant is tampered', () => {
    const keys = generateKeyPair(passphrase);
    const mandate = createMandate(baseDetails(), keys.privateKey, passphrase);
    expect(verifyMandate(mandate, baseDetails({ merchant: 'evil.example' }))).toBe(false);
  });

  it('fails verification when the intent (cart) differs — mandate is bound to one cart', () => {
    const keys = generateKeyPair(passphrase);
    const mandate = createMandate(baseDetails(), keys.privateKey, passphrase);
    const otherIntentHash = hashIntent({ ...intent, ship_to_ref: 'vaultB:addr-2' });
    expect(verifyMandate(mandate, baseDetails({ intentHash: otherIntentHash }))).toBe(false);
  });

  it('fails verification when the signature is bit-flipped', () => {
    const keys = generateKeyPair(passphrase);
    const details = baseDetails();
    const mandate = createMandate(details, keys.privateKey, passphrase);
    const sig = Buffer.from(mandate.signature, 'base64');
    sig[0] ^= 0xff;
    const tampered = { ...mandate, signature: sig.toString('base64') };
    expect(verifyMandate(tampered, details)).toBe(false);
  });

  it('fails verification with the wrong public key', () => {
    const keys = generateKeyPair(passphrase);
    const other = generateKeyPair(passphrase);
    const details = baseDetails();
    const mandate = createMandate(details, keys.privateKey, passphrase);
    expect(verifyMandate({ ...mandate, publicKey: other.publicKey }, details)).toBe(false);
  });

  it('throws when signing with the wrong passphrase', () => {
    const keys = generateKeyPair(passphrase);
    expect(() => createMandate(baseDetails(), keys.privateKey, 'wrong-pass')).toThrow();
  });

  it('returns false (never throws) on a malformed mandate', () => {
    const garbage = {
      txId: 'x',
      detailsHash: 'deadbeef',
      signature: 'not-base64-sig',
      publicKey: 'not-a-pem',
      timestamp: '2026-06-22T10:00:00.000Z',
    };
    expect(verifyMandate(garbage, baseDetails())).toBe(false);
  });
});

describe('isMandateFresh', () => {
  const keys = generateKeyPair(passphrase);
  const details = baseDetails({ timestamp: '2026-06-22T10:00:00.000Z' });
  const mandate = createMandate(details, keys.privateKey, passphrase);
  const mintedMs = Date.parse('2026-06-22T10:00:00.000Z');

  it('accepts a mandate within the freshness window', () => {
    expect(isMandateFresh(mandate, mintedMs + 60_000, 15 * 60_000)).toBe(true);
  });

  it('rejects a mandate older than the window (stale replay)', () => {
    expect(isMandateFresh(mandate, mintedMs + 16 * 60_000, 15 * 60_000)).toBe(false);
  });

  it('rejects a mandate timestamped in the future', () => {
    expect(isMandateFresh(mandate, mintedMs - 1000, 15 * 60_000)).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(isMandateFresh({ ...mandate, timestamp: 'nonsense' }, mintedMs, 15 * 60_000)).toBe(false);
  });
});
