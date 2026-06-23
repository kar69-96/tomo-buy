import { describe, it, expect } from 'vitest';
import { NotImplementedError, type CardRef, type TaskIntent } from '@tomo/core';
import { stubDeps } from './stub-deps.js';

const card: CardRef = {
  cardId: 'card_1',
  cardholderId: 'ch_1',
  merchantId: 'm',
  amountCents: 100,
  status: 'active',
};
const intent: TaskIntent = {
  merchant_id: 'm',
  cart_spec: { natural: 'x' },
  price_ceiling_cents: 100,
  account_bound: false,
  ship_to_ref: 'r',
};

describe('stubDeps — fail-closed defaults', () => {
  it('side-effecting seams throw NotImplementedError', async () => {
    await expect(stubDeps.issueCard('u', 100, 'm')).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubDeps.closeCard(card)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubDeps.revalidate(intent)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubDeps.placeOrder(intent, card)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stubDeps.enqueueAccountClaim(intent)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('read seams report "nothing happened" so recon can never falsely settle', async () => {
    await expect(stubDeps.getEvents('card_1')).resolves.toEqual([]);
    await expect(stubDeps.isCardSpent(card)).resolves.toBe(false);
    await expect(stubDeps.findMerchantOrder(intent, 'card_1')).resolves.toBe(false);
  });
});
