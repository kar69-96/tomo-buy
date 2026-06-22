import type {
  CardholderRef,
  CardRef,
  PAN_CVV_EXP,
  Txn,
  ChargeEvent,
  Settlement,
  OrderSpec,
} from '../schemas/funding.js';

// Re-export the data types alongside the interfaces so consumers import both from one place.
export type {
  CardholderRef,
  CardRef,
  CardStatus,
  PAN_CVV_EXP,
  Txn,
  TxnStatus,
  ChargeEvent,
  ChargeEventType,
  OrderItem,
  OrderSpec,
  Settlement,
  SettlementStatus,
} from '../schemas/funding.js';

/**
 * FundingRail (§4) — the single-use card rail interface. The rest of the system
 * depends on this interface, never on a concrete issuer (AgentcardRail, etc.).
 *
 * SECRET-FLOW RULE: `getCardSecret` output flows ONLY into the trusted-side
 * Executor's page-fill path. It is never returned to the LLM, never logged,
 * never placed in a TaskIntent. Fetched just-in-time before injection, discarded
 * after. (CLAUDE.md prime directive.)
 */
export interface FundingRail {
  /** Create the cardholder if absent; returns a reference (no secret). */
  ensureCardholder(userId: string): Promise<CardholderRef>;

  /** Issue a single-use card and place an authorization hold for `amountCents`. */
  issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef>;

  /** TRUSTED-side only. Returns `{ pan, cvv, expiry }`. Never reaches the LLM or logs. */
  getCardSecret(cardRef: CardRef): Promise<PAN_CVV_EXP>;

  /** Release the hold on abandon (idempotent). */
  closeCard(cardRef: CardRef): Promise<void>;

  /** Reconciliation read — sourced from the webhook event store. */
  listTransactions(cardRef: CardRef): Promise<Txn[]>;

  /** Settlement/decline/reversal webhook sink; appends to the event store. */
  onWebhook(event: ChargeEvent): void;
}

/**
 * MachineRail (P0) — separate, DEFERRED. Settles directly over a protocol
 * (x402/MPP) against a self-catalog vendor. Never touches Agentcard. The
 * settlement wallet keys are server-side only, never in model context.
 */
export interface MachineRail {
  pay(catalogVendorId: string, amountCents: number, order: OrderSpec): Promise<Settlement>;
  setControls(c: {
    dailyCents?: number;
    perTxCents?: number;
    allowedVendors?: string[];
  }): Promise<void>;
}
