import { z } from 'zod';
import { Cents } from './common.js';

/** One structured cart line. Optional — `natural` may carry the whole request. */
export const CartItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

/** The cart description: free-text plus optional structured items. */
export const CartSpecSchema = z.object({
  natural: z.string().min(1),
  items: z.array(CartItemSchema).optional(),
});

/**
 * TaskIntent (§3.2) — parsed per request by the LLM, then validated here before
 * any side effect. **Carries references, never secrets.** `ship_to_ref` is a
 * pointer the Executor resolves against Vault B; the address never appears here
 * or in LLM context.
 */
export const TaskIntentSchema = z.object({
  merchant_id: z.string().min(1),
  cart_spec: CartSpecSchema,
  price_ceiling_cents: Cents,
  account_bound: z.boolean(),
  ship_to_ref: z.string().min(1),
});

export type CartItem = z.infer<typeof CartItemSchema>;
export type CartSpec = z.infer<typeof CartSpecSchema>;
export type TaskIntent = z.infer<typeof TaskIntentSchema>;
