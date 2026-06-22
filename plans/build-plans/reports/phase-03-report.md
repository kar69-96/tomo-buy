# Phase 03 Report — Vaults A/B + Executor trust boundary

- **Wave:** 2
- **Branch / PR:** feat/phase-03 → #4
- **Owned packages:** `packages/vaults/`, `packages/executor/`
- **Date:** 2026-06-22
- **Result:** ✅ complete

## What was built

### `@tomo/vaults`
- **`crypto.ts`** — AES-256-GCM with PBKDF2-SHA512 (100k iterations, 32B key/salt, 16B IV),
  ported from AgentPay `useagentpay-x402/packages/sdk/src/vault/vault.ts`. Generalized to encrypt
  an arbitrary UTF-8 string. `decrypt` throws `VaultError` on a wrong passphrase or any tampering
  (GCM auth-tag mismatch); the failure never reveals which check failed.
- **`store.ts`** — `VaultStore` interface (`get/put/has/delete/deletePrefix/keys`) with two impls:
  `InMemoryStore` (tests/ephemeral) and `EncryptedFileStore` (local-dev; JSON of encrypted blobs
  written `0o600` — no plaintext ever touches disk). `selectStore(env)` chooses by `VAULT_STORE_FILE`.
- **`audit.ts`** — append-only per-field access log. Each entry is `{ user, field, at, requester }`;
  values are never recorded (data minimization). Entries are frozen; reads return immutable copies.
- **`vault-a.ts`** — `VaultA`: write-once agent credential per `(user, merchant)` (rejects
  overwrite), `read()` is Executor-only and returns the `AgentCredential`. Encrypted at rest.
- **`vault-b.ts`** — `VaultB`: `releaseField(user, field)` returns exactly one field and appends
  exactly one audit entry. There is **no** bulk-read method (structural data minimization).
  `deleteUser(user)` drops every encrypted record for the user (cryptographic erasure).

### `@tomo/executor`
- **`placeholder.ts`** — `PLACEHOLDER_MAP`, `getPlaceholderVariables()` (`%var%`),
  `credentialsToSwapMap()`, and `getAtomicSwapScript()` ported **VERBATIM** from AgentPay
  `executor/placeholder.ts`. The `%var%` set and `getAtomicSwapScript()` are byte-for-byte unchanged.
- **`browser/driver.ts`** — narrow `BrowserDriver` interface. No method returns or accepts a real
  secret except `evaluateSwap`, which hands the swap map to in-page JS only.
- **`browser/playwright-driver.ts`** — live driver over **local headless Chrome via Playwright**
  (prefers system Chrome channel, falls back to bundled Chromium). The atomic swap runs in-page;
  real values never cross back to Node.
- **`guardrails.ts`** — §12 re-validation, each throwing `ExecutorError`: `assertAmountWithinCeiling`,
  `assertShipToFromVault` (used address must equal the Vault B record — blocks page-injected
  addresses), `assertMerchantMatches`, and `surfaceInstructions` (returns prompt-injection-style
  snippets for the user; never acts on them).
- **`executor.ts`** — orchestrates: run guardrails on trusted state → discover fields → fill with
  placeholder markers (each fill recorded to an agent-visible transcript as `%var%`) → assemble the
  real swap map trusted-side from `VaultB.releaseField` + `getCardSecret` (card secret fetched once,
  cached) → atomic swap + submit → return a flag-only `ExecutorResult`. Secrets never enter the
  transcript or the logger.

## Test results
- Command: `pnpm test --filter @tomo/vaults --filter @tomo/executor`
- **Vaults:** Suites 5/5, Tests 33/33. Coverage (lines): **100%** (stmts/branches/funcs/lines all 100%).
- **Executor:** Suites 5/5, Tests 28/28. Coverage (lines): **100%**; branches **89.65%** (target ≥ 80%).
- Full workspace `pnpm test`: 13/13 packages green.
- Build: `pnpm build` ✅ (all 12 build tasks succeed, incl. DTS).

**Prime-directive gate (`executor.prime-directive.test.ts`):** ✅ **PASSED.** Runs against a local
mock checkout form in **real headless Chrome** and asserts:
1. the agent-visible transcript contains only `%var%` placeholders — never a real PAN/CVV/PII string;
2. the server log sink contains no real secret;
3. the real PAN/PII appear in the live DOM only **after** the atomic swap (read back via the driver);
4. the Executor returns flags only (`{ success, confirmationId, surfaced }` — no secret-typed field);
5. the card secret is fetched exactly once.
A second case proves a field filled pre-swap holds the placeholder marker (`{{card_number}}`), not a secret.

## Failures & known gaps  (be honest)
| Item | Severity | Why it failed / what's missing | Triaged to |
|---|---|---|---|
| Production KMS-encrypted Postgres store | medium | Not wired — no DB/KMS in this environment. The `VaultStore` interface + `EncryptedFileStore` (local-dev path) are complete and tested; the prod adapter implements the same interface later. | Follow-up / Wave 3 infra |
| Live remote-browser provider | low | Runbook named a Browserbase driver; per user instruction we use local headless Chrome (Playwright) instead. Functionally equivalent for the trust boundary. | Accepted deviation |
| `playwright-driver.ts` not in coverage % | low | Excluded from coverage thresholds (Playwright I/O glue); it **is** exercised live by the prime-directive gate test. | Accepted |
| Vault A login wiring in Executor | low | `vaultA` is an optional dep; the P2 guest-checkout slice does not log in, so the login path is not yet invoked. | phase that lands P1/P3 |

Failure-triage checklist:
- [x] Every failing/skipped test is listed above with a reason. (None failing/skipped.)
- [x] Every stub or `TODO` left in owned code is listed. (Prod store adapter only — interface present.)
- [x] Anything that "works locally but not in CI/sandbox" is called out. (Prime-directive test needs a
      Chromium/Chrome binary; `pnpm exec playwright install chromium` is required in CI.)
- [x] No secret leaked into logs/LLM context (verified by the prime-directive gate test).

## Deviations from the plan
- **Browser driver:** local headless Chrome via Playwright instead of Browserbase, at the user's
  explicit instruction. Same §12 boundary (in-page atomic swap, values never return to Node).
- **`pnpm-lock.yaml`** (a root file) changed to add `playwright` + `happy-dom` + `@vitest/coverage-v8`.
  This is outside the two owned package dirs but is unavoidable for new dependencies; no other
  package's source was touched.
- The verbatim `credentialsToSwapMap`/`BillingCredentials` are retained for port fidelity; the
  Executor builds its own swap map from Vault B + `getCardSecret` and uses `getAtomicSwapScript()`
  directly.

## Follow-ups
- Wire the KMS-encrypted Postgres `VaultStore` for production behind the existing interface.
- Exercise Vault A login in the Executor when an account-bound path (P1/P3) lands.
- Wire the real `FundingRail.getCardSecret` (Wave 3) into the Executor in place of the test fake.

## Open-decision (§15) items touched
- Vault storage backend (file vs KMS-Postgres) — landed the local-dev path; prod adapter deferred.
- Remote vs local browser execution — chose local headless Chrome for this slice.

## Sign-off
- [x] Definition of Done in the phase file met
- [x] Report is accurate and honest about what didn't work
