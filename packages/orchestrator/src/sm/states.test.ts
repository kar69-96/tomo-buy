import { describe, it, expect } from 'vitest';
import { CheckoutStatus, canTransition, isTerminal } from './states.js';

describe('canTransition', () => {
  it('allows the happy-path chain', () => {
    expect(canTransition(CheckoutStatus.CART_BUILT, CheckoutStatus.AWAITING_APPROVAL)).toBe(true);
    expect(canTransition(CheckoutStatus.AWAITING_APPROVAL, CheckoutStatus.CARD_ISSUED)).toBe(true);
    expect(canTransition(CheckoutStatus.CARD_ISSUED, CheckoutStatus.CHARGE_PENDING)).toBe(true);
    expect(canTransition(CheckoutStatus.CHARGE_PENDING, CheckoutStatus.SETTLED)).toBe(true);
  });

  it('allows every CHARGE_PENDING outcome', () => {
    for (const to of [
      CheckoutStatus.SETTLED,
      CheckoutStatus.DECLINED,
      CheckoutStatus.ABANDONED,
      CheckoutStatus.NEEDS_RECON,
    ]) {
      expect(canTransition(CheckoutStatus.CHARGE_PENDING, to)).toBe(true);
    }
  });

  it('allows abandon from the approval gate and after card issue', () => {
    expect(canTransition(CheckoutStatus.AWAITING_APPROVAL, CheckoutStatus.ABANDONED)).toBe(true);
    expect(canTransition(CheckoutStatus.CARD_ISSUED, CheckoutStatus.ABANDONED)).toBe(true);
  });

  it('rejects skipping the approval gate', () => {
    expect(canTransition(CheckoutStatus.CART_BUILT, CheckoutStatus.CARD_ISSUED)).toBe(false);
  });

  it('rejects leaving a terminal state', () => {
    expect(canTransition(CheckoutStatus.SETTLED, CheckoutStatus.CHARGE_PENDING)).toBe(false);
    expect(canTransition(CheckoutStatus.ABANDONED, CheckoutStatus.CART_BUILT)).toBe(false);
  });
});

describe('isTerminal', () => {
  it('marks the four outcomes terminal', () => {
    for (const s of [
      CheckoutStatus.SETTLED,
      CheckoutStatus.DECLINED,
      CheckoutStatus.ABANDONED,
      CheckoutStatus.NEEDS_RECON,
    ]) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  it('marks in-flight states non-terminal', () => {
    for (const s of [
      CheckoutStatus.CART_BUILT,
      CheckoutStatus.AWAITING_APPROVAL,
      CheckoutStatus.CARD_ISSUED,
      CheckoutStatus.CHARGE_PENDING,
    ]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});
