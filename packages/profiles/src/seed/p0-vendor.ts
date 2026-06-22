import type { P0VendorCatalogEntry } from '@tomo/core';

/**
 * One P0 vendor catalog entry (§3.5). Presence in the catalog — a live endpoint
 * plus a settlement protocol — is what makes a vendor a terminal rail. Used by
 * the machine-rail path (P0); deferred in this build but seeded for routing tests.
 */
export const p0Vendor: P0VendorCatalogEntry = {
  vendor_id: 'mpp-coffee-roaster',
  name: 'MPP Coffee Roaster',
  category: 'coffee',
  protocol: 'x402',
  endpoint: 'https://rail.mpp-coffee.example/v1/order',
  order_schema: {
    sku: 'string',
    qty: 'integer',
  },
  pricing: {
    unit: 'bag-12oz',
    amount_cents: 1800,
    currency: 'USD',
  },
  settlement: {
    chain: 'base',
    asset: 'USDC',
  },
  last_verified_at: '2026-06-01T00:00:00.000Z',
  catalog_version: 1,
};
