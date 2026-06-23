import type { MerchantProfile } from '@tomo/core';

/**
 * A Lane-A (Agentcard partner) merchant. Exercises the STEP 0 short-circuit:
 * in this build the BuyToolRail stub returns EXPLAIN_CANT(lane_a_unavailable),
 * because the Agentcard /buy MCP tool is not yet available.
 */
export const laneAMerchant: MerchantProfile = {
  merchant_id: 'agentcard-partner-eats',
  lane: 'A',
  terminal_rail: false,
  sso_grant: false,
  guest_checkout: false,
  account_required: true,
  automation_hostility: 'med',
  forces_3ds: false,
  phone_required: true,
  profile_version: 1,
  last_verified_at: '2026-06-01T00:00:00.000Z',
};
