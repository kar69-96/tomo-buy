/**
 * Trusted-side approval-mandate signer (Ed25519, `node:crypto` via
 * `@tomo/orchestrator`). The api is the human-authorization surface: when a user
 * approves, we sign a mandate binding the EXACT cart + approved total + freshness,
 * and the workflow verifies it before issuing a card.
 *
 * The workflow rebuilds `ApprovalDetails` as:
 *   { txId: workflowId, merchant: intent.merchant_id, amountCents: approvedTotalCents,
 *     intentHash: hashIntent(intent), timestamp: mandate.timestamp }
 * so we must sign those exact fields. (`verifyMandate` trusts the mandate's embedded
 * public key; the security property is the binding + freshness, not key pinning.)
 */
import {
  generateKeyPair,
  createMandate,
  hashIntent,
  type ApprovalDetails,
  type ApprovalMandate,
} from '@tomo/orchestrator';
import type { TaskIntent } from '@tomo/core';
import type { MandateSigner } from './ports.js';

export function createMandateSigner(passphrase: string): MandateSigner {
  if (!passphrase) throw new Error('mandate signer requires a non-empty passphrase');
  const keyPair = generateKeyPair(passphrase);

  return {
    publicKey: keyPair.publicKey,
    sign(
      workflowId: string,
      intent: TaskIntent,
      approvedTotalCents: number,
      timestamp: string,
    ): ApprovalMandate {
      const details: ApprovalDetails = {
        txId: workflowId,
        merchant: intent.merchant_id,
        amountCents: approvedTotalCents,
        intentHash: hashIntent(intent),
        timestamp,
      };
      return createMandate(details, keyPair.privateKey, passphrase);
    },
  };
}
