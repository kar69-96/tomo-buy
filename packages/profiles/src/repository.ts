import type { MerchantProfile, P0VendorCatalogEntry } from '@tomo/core';
import { seedMerchantProfiles, seedP0Vendors } from './seed/index.js';

/** Recursively freeze an object so a returned copy cannot be mutated in place. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const profilesById: ReadonlyMap<string, MerchantProfile> = new Map(
  seedMerchantProfiles.map((p) => [p.merchant_id, p]),
);

const vendorsById: ReadonlyMap<string, P0VendorCatalogEntry> = new Map(
  seedP0Vendors.map((v) => [v.vendor_id, v]),
);

/**
 * Look up a merchant profile by id. Returns a frozen deep copy (immutability:
 * the caller can never mutate the backing store), or `undefined` if unknown.
 *
 * Static for now; the source becomes a verified profile store in a later phase.
 * The profile is re-derived on each run so a merchant that ships SSO graduates
 * automatically — no router change required.
 */
export function getProfile(merchantId: string): MerchantProfile | undefined {
  const profile = profilesById.get(merchantId);
  if (!profile) return undefined;
  return deepFreeze(structuredClone(profile));
}

/**
 * Look up a P0 vendor catalog entry by id. Returns a frozen deep copy, or
 * `undefined` if the vendor is not in the catalog.
 */
export function getP0Vendor(
  vendorId: string,
): P0VendorCatalogEntry | undefined {
  const vendor = vendorsById.get(vendorId);
  if (!vendor) return undefined;
  return deepFreeze(structuredClone(vendor));
}
