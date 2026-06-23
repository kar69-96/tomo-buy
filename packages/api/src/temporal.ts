/**
 * `TemporalPort` over `@temporalio/client`. The same adapter serves production
 * (a real `Client` against the dev server) and the integration test (the test
 * env's `Client`) — only the injected client differs.
 *
 * We start the workflow by its registered type name `'checkout'` so the api never
 * imports the workflow bundle into its own build.
 */
import type { Client } from '@temporalio/client';
import {
  CHECKOUT_TASK_QUEUE,
  approveSignal,
  rejectSignal,
  statusQuery,
  type CheckoutWorkflowArgs,
  type CheckoutStatus,
  type ApproveInput,
} from '@tomo/orchestrator';
import type { TemporalPort } from './ports.js';

export const CHECKOUT_WORKFLOW_TYPE = 'checkout';

export function makeTemporalAdapter(client: Client, taskQueue: string = CHECKOUT_TASK_QUEUE): TemporalPort {
  return {
    async start(args: CheckoutWorkflowArgs, workflowId: string): Promise<void> {
      await client.workflow.start(CHECKOUT_WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [args],
      });
    },

    async approve(workflowId: string, input: ApproveInput): Promise<void> {
      await client.workflow.getHandle(workflowId).signal(approveSignal, input);
    },

    async reject(workflowId: string): Promise<void> {
      await client.workflow.getHandle(workflowId).signal(rejectSignal);
    },

    async status(workflowId: string): Promise<CheckoutStatus> {
      return client.workflow.getHandle(workflowId).query(statusQuery);
    },
  };
}
