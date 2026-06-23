/**
 * Injection seams (ports) the Hono app depends on. The composition root
 * (`composition.ts` / `start-server.ts`) supplies real implementations; tests
 * supply fakes. Keeping the app behind ports is what makes every route unit
 * testable in-process and the one Temporal integration test deterministic.
 */
import type { MerchantProfile, TaskIntent, ChargeEvent } from '@tomo/core';
import type {
  CheckoutWorkflowArgs,
  CheckoutStatus,
  ApproveInput,
} from '@tomo/orchestrator';

/** The LLM completion seam consumed by `@tomo/intent` `parseIntent`. */
export type CompleteFn = (system: string, user: string) => Promise<string>;

/** Merchant-profile lookup (`@tomo/profiles` `getProfile`). */
export type GetProfile = (merchantId: string) => MerchantProfile | undefined;

/**
 * Everything the api needs from Temporal, behind a tiny port. The real adapter
 * wraps `@temporalio/client`; the integration test passes the same adapter over
 * the test env's client.
 */
export interface TemporalPort {
  /** Start the `checkout` workflow with a caller-chosen workflowId. */
  start(args: CheckoutWorkflowArgs, workflowId: string): Promise<void>;
  /** Signal `approve` with the signed mandate + approved total. */
  approve(workflowId: string, input: ApproveInput): Promise<void>;
  /** Signal `reject`. */
  reject(workflowId: string): Promise<void>;
  /** Query the live workflow status. */
  status(workflowId: string): Promise<CheckoutStatus>;
}

/**
 * Webhook ingestion seam. The real sink verifies the `whsec_` signature and
 * appends to the shared event store (reuses `@tomo/funding` `verifyAndIngest`).
 * Throws on a bad signature / payload — never silently swallow.
 */
export interface WebhookSink {
  ingest(rawBody: string, signatureHeader: string | undefined | null): ChargeEvent;
}

/** Signs an Ed25519 approval mandate trusted-side (holds the keypair). */
export interface MandateSigner {
  readonly publicKey: string;
  sign(
    workflowId: string,
    intent: TaskIntent,
    approvedTotalCents: number,
    timestamp: string,
  ): import('@tomo/orchestrator').ApprovalMandate;
}
