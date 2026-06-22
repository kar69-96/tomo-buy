import {
  FundingError,
  ExplainReasonSchema,
  type ExplainReason,
  type FundingRail,
  type CardholderRef,
  type CardRef,
  type PAN_CVV_EXP,
  type Txn,
  type ChargeEvent,
} from '@tomo/core';

/**
 * The EXPLAIN_CANT reason Lane A surfaces in this build. Agentcard's `/buy` MCP
 * tool is not in the public docs (see plans/spec/01-reality-reconciliation.md),
 * so Lane A is deferred and routes resolve to EXPLAIN_CANT(lane_a_unavailable).
 * The router lifts this into a RoutingDecision.explain_cant in a later phase.
 */
export const LANE_A_UNAVAILABLE: ExplainReason = ExplainReasonSchema.parse({
  reason: 'lane_a_unavailable',
  offer: 'Use guest checkout (Lane B) for this merchant instead.',
  disclose_whats_lost: true,
});

/** A FundingError carrying the EXPLAIN_CANT detail so callers can render it. */
export class LaneAUnavailableError extends FundingError {
  readonly explainCant: ExplainReason = LANE_A_UNAVAILABLE;
  constructor() {
    super(`Lane A (/buy) is unavailable: ${LANE_A_UNAVAILABLE.reason}.`);
  }
}

/**
 * BuyToolRail — Lane A `/buy` stub. Implements `FundingRail` so it is swappable,
 * but every method fails closed with EXPLAIN_CANT(lane_a_unavailable). The real
 * `/buy` integration is phase-06.
 */
export class BuyToolRail implements FundingRail {
  async ensureCardholder(_userId: string): Promise<CardholderRef> {
    throw new LaneAUnavailableError();
  }
  async issueCard(_userId: string, _amountCents: number, _merchantId: string): Promise<CardRef> {
    throw new LaneAUnavailableError();
  }
  async getCardSecret(_cardRef: CardRef): Promise<PAN_CVV_EXP> {
    throw new LaneAUnavailableError();
  }
  async closeCard(_cardRef: CardRef): Promise<void> {
    throw new LaneAUnavailableError();
  }
  async listTransactions(_cardRef: CardRef): Promise<Txn[]> {
    throw new LaneAUnavailableError();
  }
  onWebhook(_event: ChargeEvent): void {
    throw new LaneAUnavailableError();
  }
}
