/**
 * Request-body schemas for the §14 endpoints. Validate every model/UI-supplied
 * value at the boundary (Zod) before any side effect — fail fast with a clear
 * message. Domain shapes (TaskIntent, RoutingDecision, ChargeEvent) reuse the
 * frozen `@tomo/core` schemas; these add the request envelopes around them.
 */
import { z } from 'zod';
import { TaskIntentSchema, RoutingDecisionSchema, Cents } from '@tomo/core';

export const IntentRequestSchema = z.object({
  userId: z.string().min(1),
  text: z.string().min(1),
});

/** `/route` body is a TaskIntent. */
export const RouteRequestSchema = TaskIntentSchema;

export const ExecuteRequestSchema = z.object({
  userId: z.string().min(1),
  intent: TaskIntentSchema,
  routing: RoutingDecisionSchema,
  /** Pre-approval price estimate (cents). Defaults to the intent ceiling if omitted. */
  estimateCents: Cents.optional(),
});

export const ApprovalRequestSchema = z.object({
  workflowId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  /** Required when approving — the final total to charge (cents). */
  approvedTotalCents: Cents.optional(),
});

export const OtpRequestSchema = z.object({
  workflowId: z.string().min(1),
  code: z.string().min(1),
});

export type IntentRequest = z.infer<typeof IntentRequestSchema>;
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type OtpRequest = z.infer<typeof OtpRequestSchema>;
