/**
 * @tomo/core — the frozen shared contracts. Every other package imports from
 * here and never redefines these interfaces, types, schemas, or errors.
 *
 * Layout:
 *   - schemas/*  : Zod validators + their `z.infer` data types (boundary validation)
 *   - types/*    : behavioral interfaces (FundingRail, MachineRail, VaultA, VaultB)
 *   - errors     : the TomoError hierarchy
 */

// --- Zod schemas + inferred data types ---
export * from './schemas/common.js';
export * from './schemas/funding.js';
export * from './schemas/profile.js';
export * from './schemas/intent.js';
export * from './schemas/routing.js';
export * from './schemas/vault.js';

// --- Behavioral interfaces (not expressible as schemas) ---
export type { FundingRail, MachineRail } from './types/funding.js';
export type { VaultA, VaultB } from './types/vault.js';

// --- Error hierarchy ---
export * from './errors.js';
