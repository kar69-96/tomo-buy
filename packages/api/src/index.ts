import type { TaskIntent, RoutingDecision } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub API surface. Accepts a parsed TaskIntent and returns a RoutingDecision. */
export class ApiStub {
  async submit(_intent: TaskIntent): Promise<RoutingDecision> {
    throw new NotImplementedError('api.submit');
  }
}
