import { describe, it, expect } from 'vitest';
import {
  parsePaymentRequirements,
  getAmountInUSD,
  getChain,
  getUSDCAddress,
  executePayment,
  createPaymentHeader,
} from './payment-handler.js';
import { base, baseSepolia } from 'viem/chains';

// Anvil/Hardhat well-known account #0 — deterministic, public, test-only key.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Helper to create a mock Response with headers
function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('parsePaymentRequirements', () => {
  it('parses valid payment requirements from header', () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '50000', // $0.05 USDC
      resource: 'https://api.example.com/data',
      description: 'API access',
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    };

    const response = mockResponse(402, {
      'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements),
    });

    const result = parsePaymentRequirements(response);
    expect(result).not.toBeNull();
    expect(result!.scheme).toBe('exact');
    expect(result!.network).toBe('base-sepolia');
    expect(result!.maxAmountRequired).toBe('50000');
    expect(result!.payTo).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('parses array-format payment requirements', () => {
    const requirements = [
      {
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '100000',
        payTo: '0xabcdef1234567890abcdef1234567890abcdef12',
      },
    ];

    const response = mockResponse(402, {
      'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements),
    });

    const result = parsePaymentRequirements(response);
    expect(result).not.toBeNull();
    expect(result!.maxAmountRequired).toBe('100000');
    expect(result!.network).toBe('base');
  });

  it('returns null when no header present', () => {
    const response = mockResponse(402);
    expect(parsePaymentRequirements(response)).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    const response = mockResponse(402, {
      'X-PAYMENT-REQUIREMENTS': 'not-json',
    });
    expect(parsePaymentRequirements(response)).toBeNull();
  });

  it('fills defaults for missing fields', () => {
    const response = mockResponse(402, {
      'X-PAYMENT-REQUIREMENTS': JSON.stringify({}),
    });

    const result = parsePaymentRequirements(response);
    expect(result).not.toBeNull();
    expect(result!.scheme).toBe('exact');
    expect(result!.network).toBe('base');
    expect(result!.maxAmountRequired).toBe('0');
    expect(result!.payTo).toBe('');
  });

  it('parses the x402 v2 base64 `payment-required` header (accepts array)', () => {
    const payload = {
      accepts: [
        {
          scheme: 'exact',
          network: 'base-sepolia',
          maxAmountRequired: '50000',
          payTo: '0x1234567890abcdef1234567890abcdef12345678',
        },
      ],
      resource: { url: 'https://api.example.com/data', description: 'API', mimeType: 'application/json' },
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const response = mockResponse(402, { 'payment-required': b64 });

    const result = parsePaymentRequirements(response);
    expect(result).not.toBeNull();
    expect(result!.maxAmountRequired).toBe('50000');
    expect(result!.resource).toBe('https://api.example.com/data');
    expect(result!.mimeType).toBe('application/json');
  });

  it('parses a flat base64 `payment-required` header', () => {
    const payload = {
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '100000',
      payTo: '0xabcdef1234567890abcdef1234567890abcdef12',
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const response = mockResponse(402, { 'payment-required': b64 });

    const result = parsePaymentRequirements(response);
    expect(result!.maxAmountRequired).toBe('100000');
    expect(result!.network).toBe('base');
  });

  it('returns null on an undecodable base64 header', () => {
    const response = mockResponse(402, { 'payment-required': '!!!not-base64-json!!!' });
    expect(parsePaymentRequirements(response)).toBeNull();
  });
});

describe('createPaymentHeader (EIP-3009 local signing)', () => {
  it('produces a base64 X-PAYMENT payload signed by the wallet (no network)', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '5000',
      resource: '',
      description: '',
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      maxTimeoutSeconds: 300,
    };

    const header = await createPaymentHeader(requirements, TEST_PRIVATE_KEY);
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));

    expect(decoded.x402Version).toBe(2);
    expect(decoded.scheme).toBe('exact');
    expect(decoded.network).toBe('eip155:84532'); // base-sepolia → EIP-155
    expect(decoded.payload.authorization.from).toBe(TEST_ADDRESS);
    expect(decoded.payload.authorization.to).toBe(requirements.payTo);
    expect(decoded.payload.authorization.value).toBe('5000');
    expect(decoded.payload.signature).toMatch(/^0x[0-9a-fA-F]+$/);
  });
});

describe('getAmountInUSD', () => {
  it('converts USDC smallest units to USD (6 decimals)', () => {
    expect(getAmountInUSD({ maxAmountRequired: '1000000' } as any)).toBe(1.0);
    expect(getAmountInUSD({ maxAmountRequired: '50000' } as any)).toBe(0.05);
    expect(getAmountInUSD({ maxAmountRequired: '100' } as any)).toBe(0.0001);
    expect(getAmountInUSD({ maxAmountRequired: '10000000' } as any)).toBe(10.0);
    expect(getAmountInUSD({ maxAmountRequired: '0' } as any)).toBe(0);
  });

  it('handles large amounts', () => {
    // $1000 USDC
    expect(getAmountInUSD({ maxAmountRequired: '1000000000' } as any)).toBe(1000);
  });
});

describe('getChain', () => {
  it('returns base for "base"', () => {
    expect(getChain('base')).toBe(base);
  });

  it('returns baseSepolia for "base-sepolia"', () => {
    expect(getChain('base-sepolia')).toBe(baseSepolia);
  });

  it('defaults to baseSepolia for unknown networks', () => {
    expect(getChain('unknown')).toBe(baseSepolia);
  });
});

describe('getUSDCAddress', () => {
  it('returns mainnet USDC for "base"', () => {
    expect(getUSDCAddress('base')).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('returns testnet USDC for "base-sepolia"', () => {
    expect(getUSDCAddress('base-sepolia')).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('defaults to testnet for unknown network', () => {
    expect(getUSDCAddress('unknown')).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });
});

describe('executePayment', () => {
  it('returns error since CDP session key signing is not yet implemented', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '50000',
      resource: '',
      description: '',
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    };

    const result = await executePayment(
      requirements,
      'test-session-key',
      '0xabcdef1234567890abcdef1234567890abcdef12',
      'base-sepolia',
    );

    expect('error' in result).toBe(true);
    expect((result as { error: string }).error).toContain('Session key signing not yet implemented');
  });
});
