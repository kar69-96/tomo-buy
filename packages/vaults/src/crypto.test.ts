import { describe, it, expect } from 'vitest';
import { VaultError } from '@tomo/core';
import { encrypt, decrypt, deriveKey, type EncryptedBlob } from './crypto.js';

describe('crypto (AES-256-GCM + PBKDF2)', () => {
  const passphrase = 'correct horse battery staple';

  it('roundtrips a plaintext', () => {
    const blob = encrypt('4111111111110042', passphrase);
    expect(decrypt(blob, passphrase)).toBe('4111111111110042');
  });

  it('roundtrips unicode and JSON payloads', () => {
    const payload = JSON.stringify({ name: 'José Ünïcode 🔐', zip: '90210' });
    const blob = encrypt(payload, passphrase);
    expect(JSON.parse(decrypt(blob, passphrase))).toEqual({ name: 'José Ünïcode 🔐', zip: '90210' });
  });

  it('produces a fresh salt + iv per call (no deterministic ciphertext)', () => {
    const a = encrypt('same', passphrase);
    const b = encrypt('same', passphrase);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it('ciphertext never contains the plaintext', () => {
    const blob = encrypt('super-secret-pan', passphrase);
    const decoded = Buffer.from(blob.ciphertext, 'base64').toString('utf8');
    expect(decoded).not.toContain('super-secret-pan');
  });

  it('rejects a wrong passphrase with VaultError', () => {
    const blob = encrypt('secret', passphrase);
    expect(() => decrypt(blob, 'wrong')).toThrow(VaultError);
  });

  it('rejects tampered ciphertext (GCM auth tag) with VaultError', () => {
    const blob = encrypt('secret', passphrase);
    const bytes = Buffer.from(blob.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    const tampered: EncryptedBlob = { ...blob, ciphertext: bytes.toString('base64') };
    expect(() => decrypt(tampered, passphrase)).toThrow(VaultError);
  });

  it('deriveKey is deterministic for the same salt and 32 bytes long', () => {
    const salt = Buffer.alloc(32, 7);
    expect(deriveKey('p', salt).equals(deriveKey('p', salt))).toBe(true);
    expect(deriveKey('p', salt).length).toBe(32);
  });
});
