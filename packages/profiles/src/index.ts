/**
 * @tomo/profiles — seed merchant profiles + P0 vendor catalog, plus a static
 * repository lookup. `getProfile`/`getP0Vendor` return frozen deep copies so the
 * backing store is never mutated by a caller.
 */
export { getProfile, getP0Vendor } from './repository.js';
export {
  seedMerchantProfiles,
  seedP0Vendors,
  guestMerchant,
  laneAMerchant,
  accountRequiredMerchant,
  p0Vendor,
} from './seed/index.js';
