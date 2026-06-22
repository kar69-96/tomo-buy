import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { RouterStub } from './index.js';

describe('RouterStub', () => {
  it('rejects route with NotImplementedError', async () => {
    const intent = { merchant_id: 'm', cart_spec: { natural: 'x' }, price_ceiling_cents: 100, account_bound: false, ship_to_ref: 'r' };
    const profile = { merchant_id: 'm', lane: 'B', terminal_rail: false, sso_grant: false, guest_checkout: true, account_required: false, automation_hostility: 'low', forces_3ds: false, phone_required: false, profile_version: 1, last_verified_at: '2026-06-22T00:00:00Z' };
    await expect(new RouterStub().route(intent, profile)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
