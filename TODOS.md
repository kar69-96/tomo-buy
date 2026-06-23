# TODOS

## HTTP Checkout Engine (Branch: HTTP)

### ~~TODO-1: Update spec with all review decisions~~ DONE
Updated `plans/HTTP-engine.md` with all 8 architectural decisions + 3 critical gap fixes + closed open questions.

### ~~TODO-2: Extract classification signal constants to shared module~~ DONE
Created `packages/core/src/classification-signals.ts` with all shared signal arrays.
Updated `packages/checkout/src/scripted-actions.ts` to import from `@bloon/core`.
Type-checks pass.

### ~~TODO-3: Define SiteProfile TypeScript interface~~ DONE
Created `packages/core/src/site-profile.ts` with full type hierarchy:
`SiteProfile`, `EndpointStep`, `ValueSource`, `DynamicValue`, `ResponseFingerprint`,
`TokenLocation`, `FieldMapping`, `StripeIntegration`, `StalenessMetadata`, and constants.
Type-checks pass.

### ~~TODO-4: Close open questions in spec~~ DONE
Bundled into TODO-1. "Resolved Questions" section replaces "Open Questions".
