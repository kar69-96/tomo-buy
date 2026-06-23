/**
 * Fail-closed default dependencies so the worker can BOOT (register workflow +
 * activities) before Wave-3 wires the concrete FundingRail / Executor / event
 * store. Every side-effecting seam throws `NotImplementedError`, and the read
 * seams report "nothing happened" so reconciliation can never falsely settle.
 *
 * This is intentionally inert: it lets us prove the worker starts cleanly
 * against the dev server without pretending the buy path works yet.
 */
import { NotImplementedError, type CardRef, type ChargeEvent, type TaskIntent } from '@tomo/core';
import type { CheckoutDeps } from '@tomo/orchestrator';

export const stubDeps: CheckoutDeps = {
  async issueCard(_userId: string, _amountCents: number, _merchantId: string): Promise<CardRef> {
    throw new NotImplementedError('issueCard — Agentcard rail wires in Wave 3.');
  },
  async closeCard(_cardRef: CardRef): Promise<void> {
    throw new NotImplementedError('closeCard — Agentcard rail wires in Wave 3.');
  },
  async revalidate(_intent: TaskIntent): Promise<{ priceCents: number; inStock: boolean }> {
    throw new NotImplementedError('revalidate — merchant probe wires in Wave 3.');
  },
  async placeOrder(_intent: TaskIntent, _cardRef: CardRef): Promise<{ placed: boolean }> {
    throw new NotImplementedError('placeOrder — trusted-side Executor wires in Wave 3.');
  },
  async getEvents(_cardId: string): Promise<ChargeEvent[]> {
    return [];
  },
  async isCardSpent(_cardRef: CardRef): Promise<boolean> {
    return false;
  },
  async findMerchantOrder(_intent: TaskIntent, _cardId: string): Promise<boolean> {
    return false;
  },
  async enqueueAccountClaim(_intent: TaskIntent): Promise<void> {
    throw new NotImplementedError('enqueueAccountClaim — account-claim queue wires in Wave 3.');
  },
};
