import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { generateWallet } from './wallet.js';

describe('generateWallet', () => {
  it('returns a 0x private key and a matching checksummed address', () => {
    const { privateKey, address } = generateWallet();
    expect(privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // address must be derivable from the private key
    expect(privateKeyToAccount(privateKey).address).toBe(address);
  });

  it('generates distinct wallets each call', () => {
    const a = generateWallet();
    const b = generateWallet();
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});
