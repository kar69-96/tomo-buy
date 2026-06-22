// MerchantProfile, automation_hostility, and the P0 vendor catalog entry are
// schema-derived (validated at boundaries). Re-exported here so consumers can
// import all "profile" contracts from ../types/profile.js.
export type {
  Lane,
  AutomationHostility,
  MerchantProfile,
  P0Protocol,
  P0Pricing,
  P0Settlement,
  P0VendorCatalogEntry,
} from '../schemas/profile.js';
