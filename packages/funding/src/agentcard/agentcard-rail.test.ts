import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FundingError, type CardRef } from '@tomo/core';
import { AgentcardRail, type CardholderProfile } from './agentcard-rail.js';
import { AgentcardClient, AgentcardError } from './client.js';

const profile: CardholderProfile = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-01-01',
  phoneNumber: '+15555550100',
  email: 'ada@example.com',
};

/** A partial AgentcardClient mock; only the methods under test are stubbed. */
function mockClient(overrides: Partial<Record<keyof AgentcardClient, unknown>> = {}) {
  return {
    createCardholder: vi.fn(async () => ({ id: 'ch_1' })),
    createCard: vi.fn(async () => ({
      id: 'card_1',
      last4: '4242',
      expiry: '12/29',
      spendLimitCents: 2500,
      balanceCents: 2500,
      status: 'OPEN' as const,
    })),
    cardDetails: vi.fn(async () => ({
      pan: '4242424242424242',
      cvv: '123',
      expiry: '12/29',
      last4: '4242',
    })),
    closeCard: vi.fn(async () => ({ id: 'card_1', status: 'CLOSED' as const })),
    ...overrides,
  } as unknown as AgentcardClient;
}

function makeRail(client: AgentcardClient) {
  return new AgentcardRail({ client, resolveProfile: () => profile });
}

const cardRef: CardRef = {
  cardId: 'card_1',
  cardholderId: 'ch_1',
  merchantId: 'm_1',
  amountCents: 2500,
  status: 'active',
};

describe('AgentcardRail.issueCard cents guard', () => {
  it('rejects amountCents > 5000 BEFORE any network call', async () => {
    const client = mockClient();
    const rail = makeRail(client);
    await expect(rail.issueCard('u1', 5001, 'm_1')).rejects.toThrow(FundingError);
    expect(client.createCard).not.toHaveBeenCalled();
    expect(client.createCardholder).not.toHaveBeenCalled();
  });

  it('rejects amountCents below the $1 minimum', async () => {
    const rail = makeRail(mockClient());
    await expect(rail.issueCard('u1', 99, 'm_1')).rejects.toThrow(/minimum/);
  });

  it('rejects non-integer cents', async () => {
    const rail = makeRail(mockClient());
    await expect(rail.issueCard('u1', 100.5, 'm_1')).rejects.toThrow(/integer/);
  });

  it('accepts the boundary 5000 and sends cents to the client', async () => {
    const client = mockClient();
    const rail = makeRail(client);
    await rail.issueCard('u1', 5000, 'm_1');
    expect(client.createCard).toHaveBeenCalledWith({ amountCents: 5000, cardholderId: 'ch_1' });
  });

  it('maps the card response to a CardRef (OPEN → active)', async () => {
    const rail = makeRail(mockClient());
    const ref = await rail.issueCard('u1', 2500, 'm_1');
    expect(ref).toEqual({
      cardId: 'card_1',
      cardholderId: 'ch_1',
      merchantId: 'm_1',
      amountCents: 2500,
      status: 'active',
    });
  });
});

describe('AgentcardRail.ensureCardholder', () => {
  it('returns a CardholderRef on success', async () => {
    const rail = makeRail(mockClient());
    const ref = await rail.ensureCardholder('u1');
    expect(ref).toEqual({ cardholderId: 'ch_1', userId: 'u1' });
  });

  it('reuses the existing cardholder on a 409 duplicate email', async () => {
    const err = new AgentcardError('dup', { status: 409, body: { id: 'ch_existing' } });
    const client = mockClient({ createCardholder: vi.fn(async () => { throw err; }) });
    const rail = makeRail(client);
    const ref = await rail.ensureCardholder('u1');
    expect(ref.cardholderId).toBe('ch_existing');
  });

  it('throws if 409 carries no reusable id', async () => {
    const err = new AgentcardError('dup', { status: 409, body: {} });
    const client = mockClient({ createCardholder: vi.fn(async () => { throw err; }) });
    const rail = makeRail(client);
    await expect(rail.ensureCardholder('u1')).rejects.toThrow(/cannot reuse/);
  });

  it('re-throws non-409 errors', async () => {
    const err = new AgentcardError('bad', { status: 400, body: {} });
    const client = mockClient({ createCardholder: vi.fn(async () => { throw err; }) });
    const rail = makeRail(client);
    await expect(rail.ensureCardholder('u1')).rejects.toBe(err);
  });
});

describe('AgentcardRail.getCardSecret (SECRET-FLOW)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns only the {pan,cvv,expiry} triple', async () => {
    const rail = makeRail(mockClient());
    const secret = await rail.getCardSecret(cardRef);
    expect(secret).toEqual({ pan: '4242424242424242', cvv: '123', expiry: '12/29' });
    expect(Object.keys(secret).sort()).toEqual(['cvv', 'expiry', 'pan']);
  });

  it('never logs the PAN or CVV to any console channel', async () => {
    const rail = makeRail(mockClient());
    await rail.getCardSecret(cardRef);
    const allLogged = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((a) => JSON.stringify(a))
      .join(' ');
    expect(allLogged).not.toContain('4242424242424242');
    expect(allLogged).not.toContain('123');
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('AgentcardRail.closeCard idempotency', () => {
  it('closes a card', async () => {
    const client = mockClient();
    const rail = makeRail(client);
    await expect(rail.closeCard(cardRef)).resolves.toBeUndefined();
    expect(client.closeCard).toHaveBeenCalledWith('card_1');
  });

  it('treats a 404 (already closed) as success', async () => {
    const err = new AgentcardError('gone', { status: 404, body: {} });
    const client = mockClient({ closeCard: vi.fn(async () => { throw err; }) });
    const rail = makeRail(client);
    await expect(rail.closeCard(cardRef)).resolves.toBeUndefined();
  });

  it('re-throws non-404 close errors', async () => {
    const err = new AgentcardError('boom', { status: 500, body: {} });
    const client = mockClient({ closeCard: vi.fn(async () => { throw err; }) });
    const rail = makeRail(client);
    await expect(rail.closeCard(cardRef)).rejects.toBe(err);
  });
});

describe('AgentcardRail.listTransactions via event store', () => {
  it('projects transaction events into Txn rows and ignores non-transaction events', async () => {
    const rail = makeRail(mockClient());
    rail.onWebhook({
      type: 'card.created',
      cardId: 'card_1',
      occurredAt: '2026-06-22T00:00:00.000Z',
    });
    rail.onWebhook({
      type: 'transaction.authorized',
      cardId: 'card_1',
      txId: 'tx_1',
      amountCents: 2500,
      occurredAt: '2026-06-22T00:01:00.000Z',
    });
    rail.onWebhook({
      type: 'transaction.cleared',
      cardId: 'card_1',
      txId: 'tx_1',
      amountCents: 2500,
      occurredAt: '2026-06-22T00:02:00.000Z',
    });
    const txns = await rail.listTransactions(cardRef);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ txId: 'tx_1', status: 'authorized', amountCents: 2500 });
    expect(txns[1].status).toBe('cleared');
  });

  it('returns an empty array for a card with no events', async () => {
    const rail = makeRail(mockClient());
    expect(await rail.listTransactions(cardRef)).toEqual([]);
  });
});
