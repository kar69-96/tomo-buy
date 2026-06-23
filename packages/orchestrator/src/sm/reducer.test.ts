import { describe, it, expect } from 'vitest';
import { ReconciliationError } from '@tomo/core';
import { CheckoutStatus } from './states.js';
import { reduce } from './reducer.js';

describe('reduce — happy path', () => {
  it('drives CART_BUILT all the way to SETTLED', () => {
    let s: CheckoutStatus = CheckoutStatus.CART_BUILT;
    s = reduce(s, { type: 'SUBMIT' });
    expect(s).toBe(CheckoutStatus.AWAITING_APPROVAL);
    s = reduce(s, { type: 'APPROVED' });
    expect(s).toBe(CheckoutStatus.CARD_ISSUED);
    s = reduce(s, { type: 'CHARGE_SUBMITTED' });
    expect(s).toBe(CheckoutStatus.CHARGE_PENDING);
    s = reduce(s, { type: 'RECONCILED', decision: 'SETTLED' });
    expect(s).toBe(CheckoutStatus.SETTLED);
  });
});

describe('reduce — approval gate', () => {
  it('T_approve timeout abandons', () => {
    expect(reduce(CheckoutStatus.AWAITING_APPROVAL, { type: 'APPROVAL_TIMEOUT' })).toBe(
      CheckoutStatus.ABANDONED,
    );
  });

  it('explicit rejection abandons', () => {
    expect(reduce(CheckoutStatus.AWAITING_APPROVAL, { type: 'APPROVAL_REJECTED' })).toBe(
      CheckoutStatus.ABANDONED,
    );
  });
});

describe('reduce — reconciliation outcomes', () => {
  const cp = CheckoutStatus.CHARGE_PENDING;
  it('SETTLED / DECLINED / ABANDONED / NEEDS_RECON map through', () => {
    expect(reduce(cp, { type: 'RECONCILED', decision: 'SETTLED' })).toBe(CheckoutStatus.SETTLED);
    expect(reduce(cp, { type: 'RECONCILED', decision: 'DECLINED' })).toBe(CheckoutStatus.DECLINED);
    expect(reduce(cp, { type: 'RECONCILED', decision: 'ABANDONED' })).toBe(CheckoutStatus.ABANDONED);
    expect(reduce(cp, { type: 'RECONCILED', decision: 'NEEDS_RECON' })).toBe(
      CheckoutStatus.NEEDS_RECON,
    );
  });

  it('RETRY_ONCE keeps the machine in CHARGE_PENDING', () => {
    expect(reduce(cp, { type: 'RECONCILED', decision: 'RETRY_ONCE' })).toBe(
      CheckoutStatus.CHARGE_PENDING,
    );
  });
});

describe('reduce — illegal transitions throw', () => {
  it('rejects approving a cart that was never submitted', () => {
    expect(() => reduce(CheckoutStatus.CART_BUILT, { type: 'APPROVED' })).toThrow(
      ReconciliationError,
    );
  });

  it('rejects reconciling before a charge is pending', () => {
    expect(() =>
      reduce(CheckoutStatus.CARD_ISSUED, { type: 'RECONCILED', decision: 'SETTLED' }),
    ).toThrow(ReconciliationError);
  });

  it('rejects RETRY_ONCE outside CHARGE_PENDING', () => {
    expect(() =>
      reduce(CheckoutStatus.CARD_ISSUED, { type: 'RECONCILED', decision: 'RETRY_ONCE' }),
    ).toThrow(ReconciliationError);
  });

  it('rejects events on terminal states', () => {
    expect(() => reduce(CheckoutStatus.SETTLED, { type: 'SUBMIT' })).toThrow(ReconciliationError);
  });
});
