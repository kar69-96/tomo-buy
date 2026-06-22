import type { MerchantProfile } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub profile store. Loads the current MerchantProfile (re-derived each run). */
export class ProfileStoreStub {
  async load(_merchantId: string): Promise<MerchantProfile> {
    throw new NotImplementedError('profiles.load');
  }
}
