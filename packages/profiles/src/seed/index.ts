import type { MerchantProfile, P0VendorCatalogEntry } from '@tomo/core';
import { guestMerchant } from './guest-merchant.js';
import { laneAMerchant } from './lane-a-merchant.js';
import { accountRequiredMerchant } from './account-required-merchant.js';
import { p0Vendor } from './p0-vendor.js';

export { guestMerchant, laneAMerchant, accountRequiredMerchant, p0Vendor };

/** All seeded merchant profiles, keyed by merchant_id at repository build time. */
export const seedMerchantProfiles: readonly MerchantProfile[] = [
  guestMerchant,
  laneAMerchant,
  accountRequiredMerchant,
];

/** All seeded P0 catalog entries, keyed by vendor_id at repository build time. */
export const seedP0Vendors: readonly P0VendorCatalogEntry[] = [p0Vendor];
