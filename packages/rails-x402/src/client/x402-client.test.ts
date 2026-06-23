import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { x402Fetch } from './x402-client.js';

// Mock global fetch
const originalFetch = globalThis.fetch;

function mockFetchResponses(...responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  let callIndex = 0;
  globalThis.fetch = vi.fn(async () => {
    const res = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    return new Response(res.body || null, {
      status: res.status,
      headers: res.headers,
    });
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('x402Fetch', () => {
  it('returns response directly for non-402 status', async () => {
    mockFetchResponses({ status: 200, body: 'OK' });

    const result = await x402Fetch('https://example.com/api');
    expect(result.paid).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(200);
  });

  it('returns error when 402 has no payment requirements header', async () => {
    mockFetchResponses({ status: 402 });

    const result = await x402Fetch('https://example.com/api');
    expect(result.paid).toBe(false);
    expect(result.error).toContain('could not parse');
  });

  it('requires approval when amount exceeds auto-approve threshold', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '1000000', // $1.00 USDC
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
    };

    mockFetchResponses({
      status: 402,
      headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) },
    });

    const result = await x402Fetch('https://example.com/api', {
      autoApproveThreshold: 0.10, // $0.10 threshold
    });

    expect(result.paid).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.amount).toBe(1.0);
  });

  it('requires approval when daily limit would be exceeded', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '50000', // $0.05 USDC
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
    };

    mockFetchResponses({
      status: 402,
      headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) },
    });

    const result = await x402Fetch('https://example.com/api', {
      autoApproveThreshold: 0.10,
      dailyLimit: 10.00,
      dailySpent: 9.99, // Almost at limit
    });

    expect(result.paid).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.error).toContain('Daily limit');
  });

  it('requires approval when no session key configured', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '5000', // $0.005 USDC (under threshold)
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
    };

    mockFetchResponses({
      status: 402,
      headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) },
    });

    const result = await x402Fetch('https://example.com/api', {
      autoApproveThreshold: 0.10,
      // No sessionKey or evmAddress
    });

    expect(result.paid).toBe(false);
    expect(result.error).toContain('No session key');
  });

  it('attempts payment when within limits and session key provided', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '5000', // $0.005 USDC
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
    };

    mockFetchResponses({
      status: 402,
      headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) },
    });

    const result = await x402Fetch('https://example.com/api', {
      autoApproveThreshold: 0.10,
      dailyLimit: 10.00,
      dailySpent: 0,
      sessionKey: 'test-session-key',
      evmAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    // executePayment returns an error since CDP integration isn't complete,
    // so paid should be false with the CDP error message
    expect(result.paid).toBe(false);
    expect(result.error).toContain('Session key signing not yet implemented');
    expect(result.amount).toBe(0.005);
  });

  it('pays via direct private-key signing and returns the paid response', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '5000', // $0.005 USDC (under threshold)
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    };
    // First call → 402 with requirements; retry (with X-PAYMENT) → 200 OK.
    mockFetchResponses(
      { status: 402, headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) } },
      { status: 200, body: 'paid-ok' },
    );

    const result = await x402Fetch('https://example.com/api', {
      autoApproveThreshold: 0.1,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });

    expect(result.paid).toBe(true);
    expect(result.amount).toBe(0.005);
    expect(result.response!.status).toBe(200);
    // the retry request carried an X-PAYMENT header
    const retryCall = (globalThis.fetch as any).mock.calls[1];
    expect(retryCall[1].headers['X-PAYMENT']).toBeTruthy();
  });

  it('reports a facilitator rejection of a private-key payment', async () => {
    const requirements = {
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '5000',
      payTo: '0x1234567890abcdef1234567890abcdef12345678',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    };
    mockFetchResponses(
      { status: 402, headers: { 'X-PAYMENT-REQUIREMENTS': JSON.stringify(requirements) } },
      { status: 400, body: 'invalid authorization' },
    );

    const result = await x402Fetch('https://example.com/api', {
      autoApproveThreshold: 0.1,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });

    expect(result.paid).toBe(false);
    expect(result.error).toContain('Payment rejected');
  });

  it('handles fetch errors gracefully', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error');
    });

    const result = await x402Fetch('https://unreachable.example.com');
    expect(result.paid).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('passes custom method and headers', async () => {
    mockFetchResponses({ status: 200, body: '{"data": true}' });

    const result = await x402Fetch('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"query": "test"}',
    });

    expect(result.paid).toBe(false);
    expect(result.response!.status).toBe(200);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].method).toBe('POST');
    expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
  });
});
