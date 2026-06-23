import { describe, it, expect } from 'vitest';
import { verifyMandate, isMandateFresh, hashIntent, type ApprovalDetails } from '@tomo/orchestrator';
import type { TaskIntent } from '@tomo/core';
import { createMandateSigner } from './mandate-signer.js';

const intent: TaskIntent = {
  merchant_id: 'merchant_guest',
  cart_spec: { natural: 'two coffees' },
  price_ceiling_cents: 5000,
  account_bound: false,
  ship_to_ref: 'vaultB:user1:default',
};

describe('createMandateSigner', () => {
  it('signs a mandate the workflow can verify (exact details binding)', () => {
    const signer = createMandateSigner('pass-phrase');
    const ts = '2026-06-22T12:00:00.000Z';
    const mandate = signer.sign('wf-1', intent, 1800, ts);

    // Rebuild details exactly as the workflow's verifyApproval activity does.
    const details: ApprovalDetails = {
      txId: 'wf-1',
      merchant: intent.merchant_id,
      amountCents: 1800,
      intentHash: hashIntent(intent),
      timestamp: mandate.timestamp,
    };
    expect(verifyMandate(mandate, details)).toBe(true);
    expect(mandate.timestamp).toBe(ts);
  });

  it('binds the approved total — a tampered amount fails verification', () => {
    const signer = createMandateSigner('pass-phrase');
    const ts = '2026-06-22T12:00:00.000Z';
    const mandate = signer.sign('wf-1', intent, 1800, ts);
    const tampered: ApprovalDetails = {
      txId: 'wf-1',
      merchant: intent.merchant_id,
      amountCents: 9999, // attacker bumps the total
      intentHash: hashIntent(intent),
      timestamp: mandate.timestamp,
    };
    expect(verifyMandate(mandate, tampered)).toBe(false);
  });

  it('produces a fresh mandate within the approval window', () => {
    const signer = createMandateSigner('pass-phrase');
    const ts = '2026-06-22T12:00:00.000Z';
    const mandate = signer.sign('wf-1', intent, 1800, ts);
    const now = Date.parse(ts) + 1000;
    expect(isMandateFresh(mandate, now, 15 * 60 * 1000)).toBe(true);
  });

  it('rejects an empty passphrase', () => {
    expect(() => createMandateSigner('')).toThrow();
  });
});
