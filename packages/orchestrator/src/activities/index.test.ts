import { describe, it, expect, vi } from 'vitest';
import { NotImplementedError, type CardRef, type ChargeEvent, type TaskIntent } from '@tomo/core';
import { createActivities, type CheckoutDeps } from './index.js';
import { createMandate, generateKeyPair, hashIntent, type ApprovalDetails } from '../mandate.js';

const intent: TaskIntent = {
  merchant_id: 'merchant.example',
  cart_spec: { natural: 'coffee' },
  price_ceiling_cents: 2000,
  account_bound: true,
  ship_to_ref: 'vaultB:addr-1',
};

const card: CardRef = {
  cardId: 'card_1',
  cardholderId: 'ch_1',
  merchantId: intent.merchant_id,
  amountCents: 1850,
  status: 'active',
};

function deps(over: Partial<CheckoutDeps> = {}): {
  d: CheckoutDeps;
  closeCard: ReturnType<typeof vi.fn>;
  enqueueAccountClaim: ReturnType<typeof vi.fn>;
} {
  const closeCard = vi.fn(async () => {});
  const enqueueAccountClaim = vi.fn(async () => {});
  const event: ChargeEvent = { type: 'transaction.authorized', cardId: 'card_1', occurredAt: '2026-06-22T10:00:00.000Z' };
  const d: CheckoutDeps = {
    issueCard: async (_u, amountCents, merchantId) => ({ ...card, amountCents, merchantId }),
    closeCard,
    revalidate: async () => ({ priceCents: 1850, inStock: true }),
    placeOrder: async () => ({ placed: true, orderRef: 'ord_1' }),
    getEvents: async () => [event],
    isCardSpent: async () => true,
    findMerchantOrder: async () => false,
    enqueueAccountClaim,
    ...over,
  };
  return { d, closeCard, enqueueAccountClaim };
}

describe('createActivities', () => {
  it('surfaceApproval returns the revalidation result', async () => {
    const { d } = deps();
    await expect(createActivities(d).surfaceApproval(intent)).resolves.toEqual({
      priceCents: 1850,
      inStock: true,
    });
  });

  it('issueCard issues for the requested cents + merchant', async () => {
    const { d } = deps();
    const ref = await createActivities(d).issueCard('user_1', 1850, intent.merchant_id);
    expect(ref.amountCents).toBe(1850);
    expect(ref.merchantId).toBe(intent.merchant_id);
  });

  it('placeOrder returns a flag only (no secret)', async () => {
    const { d } = deps();
    await expect(createActivities(d).placeOrder(intent, card)).resolves.toEqual({
      placed: true,
      orderRef: 'ord_1',
    });
  });

  it('reconcile aggregates event store + card-spent + merchant order', async () => {
    const { d } = deps();
    const facts = await createActivities(d).reconcile(card, intent);
    expect(facts.events).toHaveLength(1);
    expect(facts.cardSpent).toBe(true);
    expect(facts.orderFound).toBe(false);
  });

  it('closeCard + enqueueAccountClaim delegate to deps', async () => {
    const { d, closeCard, enqueueAccountClaim } = deps();
    const acts = createActivities(d);
    await acts.closeCard(card);
    await acts.enqueueAccountClaim(intent);
    expect(closeCard).toHaveBeenCalledWith(card);
    expect(enqueueAccountClaim).toHaveBeenCalledWith(intent);
  });

  it('verifyApproval accepts a valid, fresh mandate', async () => {
    const { d } = deps();
    const keys = generateKeyPair('pass!');
    const timestamp = '2026-06-22T10:00:00.000Z';
    const details: ApprovalDetails = {
      txId: 'wf_1',
      merchant: intent.merchant_id,
      amountCents: 1850,
      intentHash: hashIntent(intent),
      timestamp,
    };
    const mandate = createMandate(details, keys.privateKey, 'pass!');
    const ok = await createActivities(d).verifyApproval({
      mandate,
      intent,
      approvedTotalCents: 1850,
      txId: 'wf_1',
      nowMs: Date.parse(timestamp) + 1000,
      maxAgeMs: 60_000,
    });
    expect(ok).toBe(true);
  });

  it('verifyApproval rejects a mandate that does not match the approved total', async () => {
    const { d } = deps();
    const keys = generateKeyPair('pass!');
    const timestamp = new Date().toISOString();
    const details: ApprovalDetails = {
      txId: 'wf_1',
      merchant: intent.merchant_id,
      amountCents: 999,
      intentHash: hashIntent(intent),
      timestamp,
    };
    const mandate = createMandate(details, keys.privateKey, 'pass!');
    const ok = await createActivities(d).verifyApproval({
      mandate,
      intent,
      approvedTotalCents: 1850,
      txId: 'wf_1',
      nowMs: Date.parse(timestamp),
    });
    expect(ok).toBe(false);
  });

  it('verifyApproval rejects a stale (but otherwise valid) mandate', async () => {
    const { d } = deps();
    const keys = generateKeyPair('pass!');
    const timestamp = '2026-06-22T10:00:00.000Z';
    const details: ApprovalDetails = {
      txId: 'wf_1',
      merchant: intent.merchant_id,
      amountCents: 1850,
      intentHash: hashIntent(intent),
      timestamp,
    };
    const mandate = createMandate(details, keys.privateKey, 'pass!');
    const ok = await createActivities(d).verifyApproval({
      mandate,
      intent,
      approvedTotalCents: 1850,
      txId: 'wf_1',
      nowMs: Date.parse(timestamp) + 60 * 60_000, // an hour later
      maxAgeMs: 60_000,
    });
    expect(ok).toBe(false);
  });

  it('getCardSecret never returns a PAN — it fails closed until Wave 3', async () => {
    const { d } = deps();
    await expect(createActivities(d).getCardSecret(card)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('relayOtp is not implemented until phase-05', async () => {
    const { d } = deps();
    await expect(createActivities(d).relayOtp(intent)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
