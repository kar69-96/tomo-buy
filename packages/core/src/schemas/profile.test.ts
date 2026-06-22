import { describe, it, expect } from 'vitest';
import { MerchantProfileSchema, P0VendorCatalogEntrySchema } from './profile.js';
import type { MerchantProfile, P0VendorCatalogEntry } from './profile.js';

const profile: MerchantProfile = {
  merchant_id: 'sushiplace.com',
  lane: 'B',
  terminal_rail: false,
  sso_grant: false,
  guest_checkout: true,
  account_required: false,
  automation_hostility: 'low',
  forces_3ds: false,
  phone_required: false,
  profile_version: 1,
  last_verified_at: '2026-06-22T17:00:00.000Z',
};

describe('MerchantProfileSchema', () => {
  it('round-trips a full profile', () => {
    expect(MerchantProfileSchema.parse(profile)).toEqual(profile);
  });

  it('rejects an unknown lane', () => {
    expect(() => MerchantProfileSchema.parse({ ...profile, lane: 'C' })).toThrow();
  });

  it('rejects an unknown automation_hostility', () => {
    expect(() => MerchantProfileSchema.parse({ ...profile, automation_hostility: 'extreme' })).toThrow();
  });

  it('rejects a missing boolean flag', () => {
    const { forces_3ds, ...partial } = profile;
    void forces_3ds;
    expect(() => MerchantProfileSchema.parse(partial)).toThrow();
  });
});

describe('P0VendorCatalogEntrySchema', () => {
  const vendor: P0VendorCatalogEntry = {
    vendor_id: 'v_1',
    name: 'Acme API',
    category: 'compute',
    protocol: 'x402',
    endpoint: 'https://api.acme.example/pay',
    order_schema: { type: 'object' },
    pricing: { unit: 'call', amount_cents: 100, currency: 'USD' },
    settlement: { chain: 'base', asset: 'USDC' },
    last_verified_at: '2026-06-22T17:00:00.000Z',
    catalog_version: 1,
  };

  it('round-trips a catalog entry', () => {
    expect(P0VendorCatalogEntrySchema.parse(vendor)).toEqual(vendor);
  });

  it('rejects a non-URL endpoint', () => {
    expect(() => P0VendorCatalogEntrySchema.parse({ ...vendor, endpoint: 'not-a-url' })).toThrow();
  });

  it('rejects an unknown protocol', () => {
    expect(() => P0VendorCatalogEntrySchema.parse({ ...vendor, protocol: 'grpc' })).toThrow();
  });
});
