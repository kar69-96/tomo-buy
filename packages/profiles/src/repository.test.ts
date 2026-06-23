import { describe, it, expect } from 'vitest';
import {
  MerchantProfileSchema,
  P0VendorCatalogEntrySchema,
} from '@tomo/core';
import { getProfile, getP0Vendor } from './repository.js';
import {
  seedMerchantProfiles,
  seedP0Vendors,
  guestMerchant,
  laneAMerchant,
  accountRequiredMerchant,
} from './seed/index.js';

describe('seed data validity', () => {
  it('every seeded merchant profile is schema-valid', () => {
    for (const profile of seedMerchantProfiles) {
      expect(() => MerchantProfileSchema.parse(profile)).not.toThrow();
    }
  });

  it('every seeded P0 vendor entry is schema-valid', () => {
    for (const vendor of seedP0Vendors) {
      expect(() => P0VendorCatalogEntrySchema.parse(vendor)).not.toThrow();
    }
  });

  it('seeds exercise the distinct routing branches', () => {
    expect(guestMerchant.guest_checkout).toBe(true);
    expect(laneAMerchant.lane).toBe('A');
    expect(accountRequiredMerchant.account_required).toBe(true);
    expect(accountRequiredMerchant.sso_grant).toBe(false);
    expect(accountRequiredMerchant.forces_3ds).toBe(false);
  });

  it('has unique merchant ids and vendor ids', () => {
    const merchantIds = new Set(seedMerchantProfiles.map((p) => p.merchant_id));
    expect(merchantIds.size).toBe(seedMerchantProfiles.length);
    const vendorIds = new Set(seedP0Vendors.map((v) => v.vendor_id));
    expect(vendorIds.size).toBe(seedP0Vendors.length);
  });
});

describe('getProfile', () => {
  it('returns the profile for a known merchant id', () => {
    const p = getProfile('guest-goods-co');
    expect(p).toBeDefined();
    expect(p?.merchant_id).toBe('guest-goods-co');
    expect(p?.guest_checkout).toBe(true);
  });

  it('returns undefined for an unknown merchant id', () => {
    expect(getProfile('does-not-exist')).toBeUndefined();
  });

  it('returns a frozen object (immutability)', () => {
    const p = getProfile('guest-goods-co');
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('mutating a returned copy does not affect the store', () => {
    const first = getProfile('guest-goods-co')!;
    expect(() => {
      // @ts-expect-error — intentionally attempting a forbidden mutation
      first.guest_checkout = false;
    }).toThrow();
    const second = getProfile('guest-goods-co')!;
    expect(second.guest_checkout).toBe(true);
  });

  it('returns a distinct object instance per call', () => {
    const a = getProfile('guest-goods-co');
    const b = getProfile('guest-goods-co');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('getP0Vendor', () => {
  it('returns the vendor for a known id', () => {
    const v = getP0Vendor('mpp-coffee-roaster');
    expect(v).toBeDefined();
    expect(v?.vendor_id).toBe('mpp-coffee-roaster');
    expect(v?.protocol).toBe('x402');
  });

  it('returns undefined for an unknown vendor id', () => {
    expect(getP0Vendor('nope')).toBeUndefined();
  });

  it('returns a frozen object (immutability)', () => {
    const v = getP0Vendor('mpp-coffee-roaster');
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v?.pricing)).toBe(true);
  });
});
