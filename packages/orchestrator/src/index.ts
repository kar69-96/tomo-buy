import type { RoutingDecision } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub orchestrator. Drives the approval/recon/orphan workflow for a decision. */
export class OrchestratorStub {
  async run(_decision: RoutingDecision): Promise<void> {
    throw new NotImplementedError('orchestrator.run');
  }
}
