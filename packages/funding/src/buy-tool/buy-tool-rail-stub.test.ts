import { describe, it, expect } from 'vitest';
import { FundingError } from '@tomo/core';
import { BuyToolRail, LaneAUnavailableError, LANE_A_UNAVAILABLE } from './buy-tool-rail-stub.js';

const cardRef = {
  cardId: 'card_1',
  cardholderId: 'ch_1',
  merchantId: 'm_1',
  amountCents: 2500,
  status: 'active' as const,
};

describe('BuyToolRail (Lane A stub)', () => {
  const rail = new BuyToolRail();

  it('exposes the EXPLAIN_CANT(lane_a_unavailable) reason', () => {
    expect(LANE_A_UNAVAILABLE.reason).toBe('lane_a_unavailable');
    expect(LANE_A_UNAVAILABLE.disclose_whats_lost).toBe(true);
  });

  it('fails closed on every FundingRail method with LaneAUnavailableError', async () => {
    await expect(rail.ensureCardholder('u1')).rejects.toBeInstanceOf(LaneAUnavailableError);
    await expect(rail.issueCard('u1', 2500, 'm_1')).rejects.toBeInstanceOf(LaneAUnavailableError);
    await expect(rail.getCardSecret(cardRef)).rejects.toBeInstanceOf(LaneAUnavailableError);
    await expect(rail.closeCard(cardRef)).rejects.toBeInstanceOf(LaneAUnavailableError);
    await expect(rail.listTransactions(cardRef)).rejects.toBeInstanceOf(LaneAUnavailableError);
    expect(() => rail.onWebhook({ type: 'card.created', cardId: 'card_1', occurredAt: '2026-06-22T00:00:00.000Z' })).toThrow(
      LaneAUnavailableError,
    );
  });

  it('LaneAUnavailableError is a FundingError carrying the explain_cant detail', async () => {
    const err = await rail.issueCard('u1', 2500, 'm_1').catch((e) => e);
    expect(err).toBeInstanceOf(FundingError);
    expect(err.explainCant).toEqual(LANE_A_UNAVAILABLE);
  });
});
