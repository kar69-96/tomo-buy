import type { RoutingDecision, MerchantProfile, TaskIntent } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub router. Maps (intent, profile) to a RoutingDecision via the cascade. */
export class RouterStub {
  async route(_intent: TaskIntent, _profile: MerchantProfile): Promise<RoutingDecision> {
    throw new NotImplementedError('router.route');
  }
}
