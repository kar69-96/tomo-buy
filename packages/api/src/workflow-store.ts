/**
 * In-memory per-workflow record. The api needs the ORIGINAL `TaskIntent` (and the
 * routed merchant + estimate) at `/approval/resolve` time to rebuild the exact
 * `ApprovalDetails` the workflow verifies — `intentHash` binds the mandate to the
 * cart, so we cannot reconstruct it from user-supplied data at approval time.
 *
 * Immutability: stores and returns fresh copies so callers never alias internal state.
 */
import type { TaskIntent } from '@tomo/core';

export interface WorkflowRecord {
  readonly workflowId: string;
  readonly userId: string;
  readonly intent: TaskIntent;
  readonly routedMerchant: string;
  readonly estimateCents: number;
}

export class WorkflowStore {
  private readonly byId = new Map<string, WorkflowRecord>();

  put(record: WorkflowRecord): void {
    this.byId.set(record.workflowId, { ...record });
  }

  get(workflowId: string): WorkflowRecord | undefined {
    const found = this.byId.get(workflowId);
    return found ? { ...found } : undefined;
  }

  has(workflowId: string): boolean {
    return this.byId.has(workflowId);
  }

  all(): WorkflowRecord[] {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }
}
