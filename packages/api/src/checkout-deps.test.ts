import { describe, it, expect, vi } from 'vitest';
import type { CardRef, TaskIntent, Txn } from '@tomo/core';
import { assembleCheckoutDeps, parseUserFromShipToRef } from './checkout-deps.js';

const intent: TaskIntent = {
  merchant_id: 'guest-goods-co',
  cart_spec: { natural: 'one widget' },
  price_ceiling_cents: 2000,
  account_bound: false,
  ship_to_ref: 'vaultB:user1:default',
};

const cardRef: CardRef = {
  cardId: 'card-1',
  cardholderId: 'ch-user1',
  merchantId: 'guest-goods-co',
  amountCents: 1800,
  status: 'active',
};

function railStub(txns: Txn[] = []) {
  return {
    issueCard: vi.fn(async (_u: string, amountCents: number, merchantId: string): Promise<CardRef> => ({
      ...cardRef,
      amountCents,
      merchantId,
    })),
    closeCard: vi.fn(async () => {}),
    listTransactions: vi.fn(async () => txns),
  };
}

describe('parseUserFromShipToRef', () => {
  it('extracts the user from a vaultB ref', () => {
    expect(parseUserFromShipToRef('vaultB:user1:default', 'fb')).toBe('user1');
  });
  it('falls back when the ref is not a vaultB pointer', () => {
    expect(parseUserFromShipToRef('something-else', 'ch-user1')).toBe('ch-user1');
  });
});

describe('assembleCheckoutDeps', () => {
  it('issueCard / closeCard delegate to the rail', async () => {
    const rail = railStub();
    const deps = assembleCheckoutDeps({ rail, events: { byCard: () => [] }, executor: { checkout: vi.fn() } });
    const ref = await deps.issueCard('user1', 1800, 'guest-goods-co');
    expect(ref.amountCents).toBe(1800);
    expect(rail.issueCard).toHaveBeenCalledWith('user1', 1800, 'guest-goods-co');
    await deps.closeCard(ref);
    expect(rail.closeCard).toHaveBeenCalled();
  });

  it('placeOrder drives the executor with the vault-derived user + P2 routing', async () => {
    const checkout = vi.fn(async () => ({ success: true, confirmationId: 'CONF-9' }));
    const deps = assembleCheckoutDeps({
      rail: railStub(),
      events: { byCard: () => [] },
      executor: { checkout },
      confirmationSelector: '#c',
    });
    const result = await deps.placeOrder(intent, cardRef);
    expect(result).toEqual({ placed: true, orderRef: 'CONF-9' });
    expect(checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user1',
        amountCents: 1800,
        pageMerchantId: 'guest-goods-co',
        confirmationSelector: '#c',
        routing: expect.objectContaining({ path: 'P2', merchant_id: 'guest-goods-co' }),
      }),
    );
  });

  it('placeOrder reports placed:false when the executor fails', async () => {
    const deps = assembleCheckoutDeps({
      rail: railStub(),
      events: { byCard: () => [] },
      executor: { checkout: async () => ({ success: false }) },
    });
    expect(await deps.placeOrder(intent, cardRef)).toEqual({ placed: false });
  });

  it('revalidate echoes the ceiling and reports in stock', async () => {
    const deps = assembleCheckoutDeps({ rail: railStub(), events: { byCard: () => [] }, executor: { checkout: vi.fn() } });
    expect(await deps.revalidate(intent)).toEqual({ priceCents: 2000, inStock: true });
  });

  it('getEvents reads the shared store; isCardSpent reflects an authorized txn', async () => {
    const events = [
      { type: 'transaction.authorized', cardId: 'card-1', txId: 'tx-1', amountCents: 1800, occurredAt: '2026-06-22T00:00:00.000Z' },
    ];
    const txns: Txn[] = [
      { txId: 'tx-1', cardId: 'card-1', amountCents: 1800, status: 'authorized', occurredAt: '2026-06-22T00:00:00.000Z' },
    ];
    const deps = assembleCheckoutDeps({
      rail: railStub(txns),
      events: { byCard: (id) => (id === 'card-1' ? (events as never) : []) },
      executor: { checkout: vi.fn() },
    });
    expect(await deps.getEvents('card-1')).toHaveLength(1);
    expect(await deps.isCardSpent(cardRef)).toBe(true);
  });

  it('isCardSpent is false with no authorized/cleared txn', async () => {
    const deps = assembleCheckoutDeps({ rail: railStub([]), events: { byCard: () => [] }, executor: { checkout: vi.fn() } });
    expect(await deps.isCardSpent(cardRef)).toBe(false);
  });

  it('findMerchantOrder is a conservative false; enqueueAccountClaim records the merchant', async () => {
    const queue: string[] = [];
    const deps = assembleCheckoutDeps({ rail: railStub(), events: { byCard: () => [] }, executor: { checkout: vi.fn() }, accountClaimQueue: queue });
    expect(await deps.findMerchantOrder(intent, 'card-1')).toBe(false);
    await deps.enqueueAccountClaim(intent);
    expect(queue).toEqual(['guest-goods-co']);
  });
});
