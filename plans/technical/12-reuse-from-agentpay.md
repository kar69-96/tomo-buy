# Reuse from AgentPay

AgentPay (`/Users/karthikreddy/Downloads/GitHub/AgentPay`) is a production-grade TS/pnpm/Vitest/MCP
monorepo that already implements ~60% of the hard parts. **Adapt, don't reinvent.** The
`useagentpay-x402` variant has the executor, placeholder injection, vault, and x402 client in one
place; the `useagentpay` variant has the Browserbase proxy.

## Port map

| Target package | Source file(s) | Adaptation |
|---|---|---|
| `vaults` | `useagentpay-x402/packages/sdk/src/vault/vault.ts` (AES-256-GCM, PBKDF2 100k), `vault/types.ts` (`BillingCredentials`) | Split into **Vault A** (agent secrets) + **Vault B** (PII) with field-level release + per-field audit log; swap local-file store for KMS-encrypted Postgres |
| `executor` | `useagentpay-x402/packages/sdk/src/executor/executor.ts`, `executor/placeholder.ts` | Keep `%var%` placeholder map + `getAtomicSwapScript()` DOM-swap **verbatim**; feed values from Vault B + Agentcard `getCardSecret` instead of local creds |
| `executor` (browser) | `useagentpay/packages/mcp-server/src/browser/browserbase-proxy.ts` | Reuse Browserbase session/replay handling |
| `rails-x402` | `useagentpay-x402/packages/x402/src/client/payment-handler.ts` (EIP-3009/USDC/Base), `client/wallet.ts`, `router/payment-router.ts` | Becomes `X402Rail`/`MachineRail`; drive from P0 vendor catalog; settlement wallet self-held. **Ported in Wave 2 but P0 routing wired in a deferred phase** |
| `orchestrator` | `useagentpay-x402/packages/sdk/src/transactions/` state machine, `auth/mandate.ts` (Ed25519) | Port state model into a Temporal workflow; keep mandate signing for approval proof |
| `core` | `errors.ts`, `config/types.ts`, Vitest + tmpdir test patterns | Reuse error hierarchy + test conventions |
| MCP scaffold | `useagentpay/packages/mcp-server/src/server.ts`, `tools/` | Reuse for exposing the router as an MCP tool surface (later) |

## Confirmed-present source files (verified this session)

```
useagentpay-x402/packages/x402/src/client/payment-handler.ts
useagentpay-x402/packages/x402/src/router/payment-router.ts
useagentpay-x402/packages/sdk/src/executor/executor.ts
useagentpay-x402/packages/sdk/src/executor/placeholder.ts
useagentpay-x402/packages/sdk/src/vault/vault.ts
useagentpay/packages/mcp-server/src/browser/browserbase-proxy.ts
```

## Placeholder injection — the key reusable pattern

`placeholder.ts` exports `PLACEHOLDER_MAP`, `getPlaceholderVariables()` (the `%var%` set the AI
sees), `credentialsToSwapMap()`, and `getAtomicSwapScript()` (a `page.evaluate()` function that
swaps placeholders → real values, dispatches `input`/`change`, and clicks submit). This **is** the
§12 trust boundary — port it directly into `packages/executor`. See `10-executor-trust-boundary.md`.

## What is NOT reused

- AgentPay's local-first, file-based vault/budget storage → replaced by KMS-encrypted Postgres.
- AgentPay's "user holds their own card in an encrypted local vault" model → replaced by Agentcard
  issuing single-use cards (we never custody the PAN at rest; we fetch it just-in-time via
  `getCardSecret`).
- AgentPay's manual dashboard approval → replaced by the Temporal-driven approval gate + text UI.

## Adaptation guardrails

- Keep AgentPay's immutability + small-file conventions.
- Re-target any "card lives in vault" assumption to "card is fetched just-in-time from
  `FundingRail.getCardSecret` and never persisted."
- Preserve the secret-never-reaches-LLM property end-to-end — it is already AgentPay's design, do
  not regress it during the port.
