import { describe, it, expect, vi, afterEach } from 'vitest';
import { routePayment } from './payment-router.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('routePayment', () => {
  it('returns browser-checkout when x402 is not enabled', async () => {
    const result = await routePayment({
      url: 'https://example.com/product',
      x402Enabled: false,
    });

    expect(result.rail).toBe('browser-checkout');
    expect(result.reason).toBe('x402 not enabled');
  });

  it('returns x402 when URL returns 402 with valid requirements', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '50000', // $0.05
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
    };

    globalThis.fetch = vi.fn(async () => new Response(null, {
      status: 402,
      headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) },
    }));

    const result = await routePayment({
      url: 'https://api.example.com/data',
      x402Enabled: true,
      usdcBalance: 10.00,
    });

    expect(result.rail).toBe('x402');
    expect(result.reason).toContain('$0.05');
  });

  it('returns browser-checkout when URL does not return 402', async () => {
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 }));

    const result = await routePayment({
      url: 'https://amazon.com/product',
      x402Enabled: true,
      usdcBalance: 10.00,
    });

    expect(result.rail).toBe('browser-checkout');
    expect(result.reason).toBe('URL does not support x402');
  });

  it('returns browser-checkout when USDC balance is insufficient', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '5000000', // $5.00
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
    };

    globalThis.fetch = vi.fn(async () => new Response(null, {
      status: 402,
      headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) },
    }));

    const result = await routePayment({
      url: 'https://api.example.com/data',
      x402Enabled: true,
      usdcBalance: 1.00, // Only $1 available
    });

    expect(result.rail).toBe('browser-checkout');
    expect(result.reason).toContain('Insufficient USDC');
  });

  it('returns browser-checkout when 402 has unparseable requirements', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, {
      status: 402,
      // No X-PAYMENT-REQUIREMENTS header
    }));

    const result = await routePayment({
      url: 'https://api.example.com/data',
      x402Enabled: true,
      usdcBalance: 10.00,
    });

    expect(result.rail).toBe('browser-checkout');
    expect(result.reason).toContain('Could not parse');
  });

  it('falls back to browser-checkout when fetch fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error');
    });

    const result = await routePayment({
      url: 'https://unreachable.example.com',
      x402Enabled: true,
      usdcBalance: 10.00,
    });

    expect(result.rail).toBe('browser-checkout');
    expect(result.reason).toBe('Failed to probe URL for x402 support');
  });
});
