import type {
  FundingRail,
  CardholderRef,
  CardRef,
  PAN_CVV_EXP,
  Txn,
  ChargeEvent,
} from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub FundingRail. Every method throws until phase-01 wires AgentcardRail. */
export class FundingRailStub implements FundingRail {
  async ensureCardholder(_userId: string): Promise<CardholderRef> {
    throw new NotImplementedError('funding.ensureCardholder');
  }
  async issueCard(_userId: string, _amountCents: number, _merchantId: string): Promise<CardRef> {
    throw new NotImplementedError('funding.issueCard');
  }
  async getCardSecret(_cardRef: CardRef): Promise<PAN_CVV_EXP> {
    throw new NotImplementedError('funding.getCardSecret');
  }
  async closeCard(_cardRef: CardRef): Promise<void> {
    throw new NotImplementedError('funding.closeCard');
  }
  async listTransactions(_cardRef: CardRef): Promise<Txn[]> {
    throw new NotImplementedError('funding.listTransactions');
  }
  onWebhook(_event: ChargeEvent): void {
    throw new NotImplementedError('funding.onWebhook');
  }
}
