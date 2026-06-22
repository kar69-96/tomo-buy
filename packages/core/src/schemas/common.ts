import { z } from 'zod';

/**
 * ISO-8601 date-time string. Defined version-independently (no reliance on a
 * specific Zod string-format helper) so the contract is stable across Zod minors.
 */
export const IsoDateTime = z
  .string()
  .refine((s) => s.length > 0 && !Number.isNaN(Date.parse(s)), {
    message: 'must be an ISO 8601 date-time string',
  });

/**
 * Money is **cents** everywhere (CLAUDE.md rule 6). A cents field is a
 * non-negative integer — a float dollar amount fails validation by construction.
 */
export const Cents = z.number().int().nonnegative();
