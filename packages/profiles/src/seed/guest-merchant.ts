import type { MerchantProfile } from '@tomo/core';

/**
 * A Lane-B merchant with guest checkout enabled — the live P2 slice for this
 * build. Not account-bound, no terminal rail: a non-account-bound intent routes
 * straight to P2 (guest), skipping the existence probe.
 */
export const guestMerchant: MerchantProfile = {
  merchant_id: 'guest-goods-co',
  lane: 'B',
  terminal_rail: false,
  sso_grant: false,
  guest_checkout: true,
  account_required: false,
  automation_hostility: 'low',
  forces_3ds: false,
  phone_required: false,
  profile_version: 1,
  last_verified_at: '2026-06-01T00:00:00.000Z',
};
