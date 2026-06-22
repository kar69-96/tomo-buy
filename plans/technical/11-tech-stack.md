# Tech Stack — Component → Vendor (§13)

| Component | Primary | Alternates / notes |
|---|---|---|
| **Language / build** | TypeScript, pnpm workspaces + Turbo, tsup, Vitest | Mirrors AgentPay conventions |
| **Card rail (P2/P3, Lane A)** | **Agentcard** Organizations REST (`AgentcardRail`) | Pluggable behind `FundingRail`: Stripe Issuing, Crossmint, Lithic, Privacy.com |
| **Machine rail (P0 only, deferred)** | **In-house x402 + MPP clients** against the in-house P0 vendor catalog | Self-held settlement wallet (USDC treasury, **not Sponge**). Also merchant agent APIs, AP2 mandates, ACP tokens where offered |
| **Browser execution (P2/P3)** | **Browserbase** (headless, server-side, per-session isolation) | Steel. Must have human-handoff / `EXPLAIN_CANT` fallback on unclearable challenge |
| **Agent email (P3, deferred)** | **AgentMail** | Catch-all domain + inbound parse via SES / Postmark / Resend. Warmed, legit-looking domain |
| **Vaults A & B** | **KMS-encrypted Postgres** or a secrets manager | Separate stores; field-level access + per-field audit log on B; deletion path on B. App/LLM tier has **no decrypt capability** — only the Executor's trusted service does |
| **SSO (P1, deferred)** | **OAuth authorization-code + PKCE** client | Encrypted per-user/per-merchant token store with refresh + revocation; re-link flow |
| **Phone / OTP** | **OTP relay** through the user text UI | Never default to pooled VoIP (Twilio etc.) — blocked by hostile merchants |
| **State / orchestration** | **Temporal** (free local dev server `temporal server start-dev`) | Durable §8 timeouts, retries-with-reconciliation, orphan cleanup that survive crashes |
| **User UI** | text / portal channel (`apps/ui`) | Approvals, OTP relay, connect/reconnect, account-claim |
| **Webhooks** | Agentcard `transaction.*` / `card.*` / `balance.low`; merchant order emails → agent inbox parse | Drives reconciliation (`06-approval-recon-sm.md`) |
| **Intent parser** | LLM via **Vercel AI Gateway** (`"anthropic/claude-…"` model string), **intent-only** | Output untrusted until Executor re-validates |

## Funding-secret discipline (applies across the table)

`getCardSecret` output flows **only** into the Executor's page-fill path; never returned to the LLM
or logged. The machine rail never exposes its settlement-wallet keys to the model — the model emits
a pay-intent and the trusted side settles. Same pattern as card digits and vault fields.

## What's actually installed in the current build (vertical slice)

- Agentcard sandbox (`sk_test_*`), Browserbase, Temporal local dev server, KMS-encrypted Postgres
  for vaults, an LLM via the AI Gateway for intent parsing.
- **Not** installed yet (deferred): x402/MPP + settlement wallet, AgentMail, OAuth/PKCE.
