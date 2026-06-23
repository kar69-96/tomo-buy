/**
 * `AppDeps` — the full set of seams `createApp` needs. The composition root builds
 * real implementations; tests build fakes. Optional clock / timeout overrides keep
 * the integration test deterministic and fast.
 */
import type {
  CompleteFn,
  GetProfile,
  TemporalPort,
  WebhookSink,
  MandateSigner,
} from './ports.js';
import type { WorkflowStore } from './workflow-store.js';
import type { OtpRelay } from './otp/relay.js';

export interface AppDeps {
  readonly temporal: TemporalPort;
  /** LLM completion for `@tomo/intent` parseIntent. */
  readonly complete: CompleteFn;
  /** Merchant-profile lookup for the router. */
  readonly getProfile: GetProfile;
  readonly signer: MandateSigner;
  readonly store: WorkflowStore;
  readonly otp: OtpRelay;
  readonly webhook: WebhookSink;
  /** Injectable clock for the mandate timestamp (defaults to `new Date()`). */
  readonly now?: () => Date;
  /** Approval-timeout override passed to the workflow (tests use a short value). */
  readonly tApproveMs?: number;
  /** Place-order retry-budget override passed to the workflow. */
  readonly maxRetries?: number;
}

/** A stable, side-effect-free id generator (crypto UUID, trusted side). */
export function newWorkflowId(merchantId: string, uuid: string): string {
  return `checkout-${merchantId}-${uuid}`;
}
