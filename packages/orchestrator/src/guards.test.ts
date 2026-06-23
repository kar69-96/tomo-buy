import { describe, it, expect } from 'vitest';
import { ApprovalError } from '@tomo/core';
import { validateChargeParams, type ChargeParams } from './guards.js';

function params(over: Partial<ChargeParams> = {}): ChargeParams {
  return {
    amountCents: 1850,
    priceCeilingCents: 2000,
    routedMerchant: 'merchant.example',
    merchant: 'merchant.example',
    ...over,
  };
}

describe('validateChargeParams', () => {
  it('passes a well-formed charge', () => {
    expect(() => validateChargeParams(params())).not.toThrow();
  });

  it('rejects a non-integer amount', () => {
    expect(() => validateChargeParams(params({ amountCents: 18.5 }))).toThrow(ApprovalError);
  });

  it('rejects a negative amount', () => {
    expect(() => validateChargeParams(params({ amountCents: -1 }))).toThrow(ApprovalError);
  });

  it('rejects an amount over the per-intent ceiling', () => {
    expect(() => validateChargeParams(params({ amountCents: 2001, priceCeilingCents: 2000 }))).toThrow(
      ApprovalError,
    );
  });

  it('rejects an amount over the absolute funding cap', () => {
    // ceiling high enough to pass check 2, but over the $50 cap.
    expect(() =>
      validateChargeParams(params({ amountCents: 5001, priceCeilingCents: 1_000_000 })),
    ).toThrow(ApprovalError);
  });

  it('honours a custom cap override', () => {
    expect(() =>
      validateChargeParams(params({ amountCents: 3000, priceCeilingCents: 1_000_000, capCents: 2500 })),
    ).toThrow(ApprovalError);
  });

  it('rejects a merchant that does not match the routed merchant', () => {
    expect(() => validateChargeParams(params({ merchant: 'evil.example' }))).toThrow(ApprovalError);
  });
});
