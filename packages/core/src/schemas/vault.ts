import { z } from 'zod';

/**
 * PII fields releasable from Vault B, one at a time (§3.3). There is no bulk
 * read into model context — ever. The Executor requests a single field at fill
 * time and the release is logged.
 */
export const PiiFieldSchema = z.enum([
  'name',
  'street',
  'city',
  'state',
  'zip',
  'country',
  'email',
  'phone',
]);

/**
 * An agent-minted credential held in Vault A (per user+merchant). Leak = one
 * agent-made account, revocable, worthless elsewhere. Read only by the Executor
 * at login — never into LLM context.
 */
export const AgentCredentialSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type PiiField = z.infer<typeof PiiFieldSchema>;
export type AgentCredential = z.infer<typeof AgentCredentialSchema>;
