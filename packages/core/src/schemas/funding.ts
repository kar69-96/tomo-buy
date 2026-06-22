import { z } from 'zod';
import { Cents, IsoDateTime } from './common.js';

/**
 * Funding-rail data payloads. These are the values that cross boundaries
 * (webhook bodies, transaction reads) and so get Zod schemas. The behavioral
 * interfaces (FundingRail, MachineRail) live in ../types/funding.ts — their
 * Promise-returning methods can't be expressed as Zod schemas.
 *
 * SECRET-FLOW RULE: PanCvvExpSchema describes card secrets. The value it
 * validates flows ONLY into the trusted-side Executor's page-fill path. It is
 * never returned to the LLM, never logged, never placed in a TaskIntent.
 */

/** Reference to a cardholder (the user's funding relationship). Carries no secret. */
export const CardholderRefSchema = z.object({
  cardholderId: z.string().min(1),
  userId: z.string().min(1),
});

/** Lifecycle status of an issued single-use card. */
export const CardStatusSchema = z.enum(['active', 'closed']);

/** Reference to an issued single-use card. Carries the card id + metadata, never the PAN. */
export const CardRefSchema = z.object({
  cardId: z.string().min(1),
  cardholderId: z.string().min(1),
  merchantId: z.string().min(1),
  amountCents: Cents,
  status: CardStatusSchema,
});

/**
 * The card secret triple. NEVER logged, NEVER in LLM context, NEVER persisted —
 * fetched trusted-side immediately before injection and discarded after.
 */
export const PanCvvExpSchema = z.object({
  pan: z.string().min(1),
  cvv: z.string().min(1),
  expiry: z.string().min(1), // "MM/YY"
});

/** Transaction lifecycle states sourced from the webhook event store (reconciliation truth). */
export const TxnStatusSchema = z.enum(['authorized', 'cleared', 'declined', 'voided']);

/** One transaction row, read from the append-only webhook event store. */
export const TxnSchema = z.object({
  txId: z.string().min(1),
  cardId: z.string().min(1),
  amountCents: Cents,
  status: TxnStatusSchema,
  merchant: z.string().optional(),
  occurredAt: IsoDateTime,
});

/** Webhook event types Agentcard emits (transaction.*, card.*, balance.low). */
export const ChargeEventTypeSchema = z.enum([
  'transaction.authorized',
  'transaction.cleared',
  'transaction.declined',
  'transaction.voided',
  'card.created',
  'card.closed',
  'balance.low',
]);

/** A webhook event payload; the rail appends these to its event store. */
export const ChargeEventSchema = z.object({
  type: ChargeEventTypeSchema,
  cardId: z.string().min(1),
  txId: z.string().optional(),
  amountCents: Cents.optional(),
  occurredAt: IsoDateTime,
});

/** A single line item in a machine-rail order. */
export const OrderItemSchema = z.object({
  sku: z.string().optional(),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  unitCents: Cents,
});

/** Structured order shape handed to MachineRail.pay for a P0 vendor. */
export const OrderSpecSchema = z.object({
  vendorId: z.string().min(1),
  items: z.array(OrderItemSchema).min(1),
  totalCents: Cents,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Settlement result from a machine-rail payment (x402/MPP). */
export const SettlementStatusSchema = z.enum(['settled', 'failed']);

export const SettlementSchema = z.object({
  settlementId: z.string().min(1),
  vendorId: z.string().min(1),
  amountCents: Cents,
  status: SettlementStatusSchema,
  chain: z.string().optional(),
  asset: z.string().optional(),
  txHash: z.string().optional(),
  occurredAt: IsoDateTime,
});

// Inferred data types — derived from schemas so the type and validator never drift (§7).
export type CardholderRef = z.infer<typeof CardholderRefSchema>;
export type CardStatus = z.infer<typeof CardStatusSchema>;
export type CardRef = z.infer<typeof CardRefSchema>;
export type PAN_CVV_EXP = z.infer<typeof PanCvvExpSchema>;
export type TxnStatus = z.infer<typeof TxnStatusSchema>;
export type Txn = z.infer<typeof TxnSchema>;
export type ChargeEventType = z.infer<typeof ChargeEventTypeSchema>;
export type ChargeEvent = z.infer<typeof ChargeEventSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type OrderSpec = z.infer<typeof OrderSpecSchema>;
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;
export type Settlement = z.infer<typeof SettlementSchema>;
