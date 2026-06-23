import type { MerchantProfile } from '@tomo/core';

/**
 * A Lane-B merchant that requires an account, offers no SSO grant, and does not
 * force 3DS. With low/medium hostility a non-account-bound intent routes to P3
 * (autonomous signup attempt); an account-bound intent with no SSO hits
 * EXPLAIN_CANT(cant_reach_existing_account).
 */
export const accountRequiredMerchant: MerchantProfile = {
  merchant_id: 'members-only-grocer',
  lane: 'B',
  terminal_rail: false,
  sso_grant: false,
  guest_checkout: false,
  account_required: true,
  automation_hostility: 'med',
  forces_3ds: false,
  phone_required: false,
  profile_version: 1,
  last_verified_at: '2026-06-01T00:00:00.000Z',
};
