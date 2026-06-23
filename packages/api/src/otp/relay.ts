/**
 * In-memory OTP relay registry, keyed by workflowId.
 *
 * The live P2 guest-checkout workflow defines NO OTP signal (a guest order never
 * issues one), and phase-05 owns only `packages/api` — it cannot add a signal to
 * the orchestrator. So `/otp/relay` writes the human-relayed code here, a working
 * channel ready for P3_ASSISTED (`relayOtp`) to consume. On the P2 happy path it
 * is acknowledged but unused; this is documented honestly in the phase report.
 */
export class OtpRelay {
  private readonly byWorkflow = new Map<string, string[]>();

  /** Record a relayed code. Throws on an empty/blank code (fail fast at the boundary). */
  relay(workflowId: string, code: string): void {
    if (!workflowId) throw new Error('otp relay requires a workflowId');
    if (!code || !code.trim()) throw new Error('otp relay requires a non-empty code');
    const existing = this.byWorkflow.get(workflowId) ?? [];
    this.byWorkflow.set(workflowId, [...existing, code.trim()]);
  }

  /** FIFO consume the next pending code for a workflow (for a future P3_ASSISTED consumer). */
  consume(workflowId: string): string | undefined {
    const queue = this.byWorkflow.get(workflowId);
    if (!queue || queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    this.byWorkflow.set(workflowId, rest);
    return next;
  }

  /** Non-destructive view of pending codes (immutable copy). */
  pending(workflowId: string): readonly string[] {
    return [...(this.byWorkflow.get(workflowId) ?? [])];
  }
}
