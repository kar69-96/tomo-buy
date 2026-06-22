import { z } from 'zod';
import { Cents, IsoDateTime } from './common.js';

/**
 * Lane: "A" = Agentcard partner (terminal /buy), "B" = self-driven checkout.
 */
export const LaneSchema = z.enum(['A', 'B']);

/**
 * automation_hostility (§3.4) — a single derived score that replaces the dead
 * `fresh_account_risk`. Gates whether autonomous P3 is even attempted.
 */
export const AutomationHostilitySchema = z.enum(['low', 'med', 'high']);

/**
 * MerchantProfile (§3.1) — static config, one row per merchant. Re-derived on
 * each run so a merchant that ships SSO graduates automatically.
 */
export const MerchantProfileSchema = z.object({
  merchant_id: z.string().min(1),
  lane: LaneSchema,
  terminal_rail: z.boolean(),
  sso_grant: z.boolean(),
  guest_checkout: z.boolean(),
  account_required: z.boolean(),
  automation_hostility: AutomationHostilitySchema,
  forces_3ds: z.boolean(),
  phone_required: z.boolean(),
  profile_version: z.number().int().nonnegative(),
  last_verified_at: IsoDateTime,
});

/** P0 vendor protocol — what the machine rail speaks to settle. */
export const P0ProtocolSchema = z.enum(['x402', 'mpp']);

export const P0PricingSchema = z.object({
  unit: z.string().min(1),
  amount_cents: Cents,
  currency: z.string().min(1),
});

export const P0SettlementSchema = z.object({
  chain: z.string().min(1),
  asset: z.string().min(1),
});

/**
 * P0 vendor catalog entry (§3.5) — self-maintained. Presence in the catalog
 * (live endpoint + protocol) is what makes `terminal_rail == true` for a vendor.
 */
export const P0VendorCatalogEntrySchema = z.object({
  vendor_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  protocol: P0ProtocolSchema,
  endpoint: z.string().url(),
  order_schema: z.record(z.string(), z.unknown()),
  pricing: P0PricingSchema,
  settlement: P0SettlementSchema,
  last_verified_at: IsoDateTime,
  catalog_version: z.number().int().nonnegative(),
});

export type Lane = z.infer<typeof LaneSchema>;
export type AutomationHostility = z.infer<typeof AutomationHostilitySchema>;
export type MerchantProfile = z.infer<typeof MerchantProfileSchema>;
export type P0Protocol = z.infer<typeof P0ProtocolSchema>;
export type P0Pricing = z.infer<typeof P0PricingSchema>;
export type P0Settlement = z.infer<typeof P0SettlementSchema>;
export type P0VendorCatalogEntry = z.infer<typeof P0VendorCatalogEntrySchema>;
