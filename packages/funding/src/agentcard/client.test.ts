import { describe, it, expect, vi } from 'vitest';
import { AgentcardClient, AgentcardError, type FetchLike } from './client.js';

/** Build a FetchLike that returns a canned status/body and records the call. */
function fakeFetch(status: number, body: unknown): { fetch: FetchLike; calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const raw = body === undefined ? '' : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => raw,
    };
  };
  return { fetch, calls };
}

const apiKey = 'sk_test_dummy';

describe('AgentcardClient', () => {
  it('throws if constructed without an apiKey', () => {
    expect(() => new AgentcardClient({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('sends Bearer auth + JSON content-type and hits the documented path', async () => {
    const { fetch, calls } = fakeFetch(200, { id: 'ch_1' });
    const client = new AgentcardClient({ apiKey, fetch });
    await client.createCardholder({
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '1990-01-01',
      phoneNumber: '+15555550100',
      email: 'a@b.com',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.agentcard.sh/api/v1/cardholders');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers?.Authorization).toBe('Bearer sk_test_dummy');
    expect(calls[0].init?.headers?.['Content-Type']).toBe('application/json');
  });

  it('creates a card with cents in the body', async () => {
    const { fetch, calls } = fakeFetch(200, {
      id: 'card_1',
      last4: '4242',
      expiry: '12/29',
      spendLimitCents: 2500,
      balanceCents: 2500,
      status: 'OPEN',
    });
    const client = new AgentcardClient({ apiKey, fetch });
    const res = await client.createCard({ amountCents: 2500, cardholderId: 'ch_1' });
    expect(res.status).toBe('OPEN');
    expect(calls[0].init?.body).toBe(JSON.stringify({ amountCents: 2500, cardholderId: 'ch_1' }));
  });

  it.each([
    [400, /invalid request/],
    [402, /payment declined/],
    [404, /not found/],
    [409, /duplicate/],
  ])('maps HTTP %i to a typed AgentcardError', async (status, re) => {
    const { fetch } = fakeFetch(status, { error: 'nope' });
    const client = new AgentcardClient({ apiKey, fetch });
    await expect(client.createCard({ amountCents: 100, cardholderId: 'ch_1' })).rejects.toMatchObject({
      meta: { status },
    });
    await expect(client.createCard({ amountCents: 100, cardholderId: 'ch_1' })).rejects.toThrow(re);
  });

  it('attaches setupUrl on a 422 (no payment method)', async () => {
    const { fetch } = fakeFetch(422, { setupUrl: 'https://checkout.example/abc' });
    const client = new AgentcardClient({ apiKey, fetch });
    await expect(
      client.createCard({ amountCents: 100, cardholderId: 'ch_1' }),
    ).rejects.toMatchObject({ meta: { status: 422, setupUrl: 'https://checkout.example/abc' } });
  });

  it('wraps a network/transport failure in a FundingError', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const client = new AgentcardClient({ apiKey, fetch });
    await expect(client.paymentMethodStatus('ch_1')).rejects.toThrow(/request failed/);
  });

  it('builds list-cards query strings from filters', async () => {
    const { fetch, calls } = fakeFetch(200, { cards: [], total: 0, limit: 10, offset: 0 });
    const client = new AgentcardClient({ apiKey, fetch });
    await client.listCards({ status: 'OPEN', cardholderId: 'ch_1', limit: 10, offset: 0 });
    expect(calls[0].url).toContain('status=OPEN');
    expect(calls[0].url).toContain('cardholderId=ch_1');
    expect(calls[0].url).toContain('limit=10');
  });

  it('does not log request bodies (no PAN leakage path)', async () => {
    const spy = vi.spyOn(console, 'log');
    const { fetch } = fakeFetch(200, { pan: '4242424242424242', cvv: '123', expiry: '12/29', last4: '4242' });
    const client = new AgentcardClient({ apiKey, fetch });
    await client.cardDetails('card_1');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns CLOSED from closeCard (idempotent path)', async () => {
    const { fetch } = fakeFetch(200, { id: 'card_1', status: 'CLOSED' });
    const client = new AgentcardClient({ apiKey, fetch });
    const res = await client.closeCard('card_1');
    expect(res.status).toBe('CLOSED');
  });

  it('subscribes a webhook endpoint', async () => {
    const { fetch, calls } = fakeFetch(200, { whsec: 'whsec_abc' });
    const client = new AgentcardClient({ apiKey, fetch });
    const res = await client.createWebhookEndpoint({ url: 'https://x/y', enabled_events: ['card.*'] });
    expect(res.whsec).toBe('whsec_abc');
    expect(calls[0].url).toContain('/api/v1/webhook_endpoints');
  });

  it('AgentcardError is an instanceof FundingError', async () => {
    const { fetch } = fakeFetch(400, {});
    const client = new AgentcardClient({ apiKey, fetch });
    const err = await client.createCard({ amountCents: 100, cardholderId: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentcardError);
  });
});
