# Tomo-buy — Agentic purchasing API (agentbuy core, Agentcard-funded)

> This file is the project's `/init` artifact. Every session — human or agent — inherits it.

## What this is

A REST backend that lets an AI agent **purchase anything on the internet** from a product URL or a
natural-language search. It discovers the product, quotes it, then drives a **local Chrome
(Playwright)** to complete checkout — paying with a **single-use virtual card issued by Agentcard**,
freshly minted per purchase and sized to the order total.

This codebase is a fork of [`kar69-96/agentbuy`](https://github.com/kar69-96/agentbuy) (codename
"Tomo"), rewired for this project:

| Concern | agentbuy upstream | This fork |
|---|---|---|
| Funding | Static card in `.env` | **Agentcard single-use cards** (CLI: issue → reveal → inject) |
| Browser | Browserbase cloud + Stagehand | **Local Playwright on Chrome** |
| LLM | Google Gemini | **OpenRouter** (key in `.env`) |
| Discovery | Firecrawl + Browserbase+Gemini | **Exa + Playwright + OpenRouter** |

The original Tomo-buy backend (Temporal/intent-router/vaults) is archived under `_tomo-archive/`.

## Prime directive (non-negotiable)

**The LLM never sees a card number — or a login password or session token.** Card PAN/CVV/expiry come
from Agentcard and are injected into the page **only via Playwright CDP** (`packages/checkout/src/fill.ts`).
Login secrets come from the encrypted vault (`packages/identity/src/vault.ts`) and are filled via direct
Playwright (`packages/checkout/src/login.ts`) — the model only ever sees the login **email/username** as a
`%var%`. None of these secrets enter the LLM prompt/response, get logged, get written to a committed file,
or get persisted into a planner run's context. Shipping/contact PII is sanitized before it goes to the LLM
as `%var%`-style variables. This invariant is structural — both `x_card_*` and `x_login_password` /
`x_session_token` are in the `CDP_FIELDS` set (`credentials.ts`); any change that routes one of these
through the model or a log is wrong by construction.

## API (the endpoints)

Core purchase flow:
- `POST /api/query` — discover product options + required fields (URL or NL `query`)
- `POST /api/buy` — get a purchase quote for a URL (does NOT spend); returns an `order_id`
- `POST /api/confirm` — issue an Agentcard, run browser checkout, return a receipt (**spends real money**)

Recommended flow: `query` → `buy` → human approval → `confirm`.

Planning agent (account-gated tasks):
- `POST /api/run` — `{ task }`: the planner builds + executes a plan (discover → login → purchase),
  choosing an **agent identity** vs the **user's connected account** per service. Returns either a
  completed result or `{ run_id, status: "awaiting_approval", gate }`.
- `POST /api/run/:id/approve` — `{ approved?, session_token? }`: clears the current gate and resumes.
  Gates: `create_account` (register a new agent account), `session_token` (log in as the user), and
  `purchase_confirm` (full price breakdown before spending).

## Rules

1. **Secrets never reach the LLM** (see Prime directive). Card details exist only in the funding/card-reveal
   path (`packages/checkout/src/agentcard.ts`); login passwords/session tokens exist only in the vault
   (`packages/identity/src/vault.ts`) and are read just-in-time by the login executor. Both flow straight
   into the direct-fill/CDP path, never the model, never logs, never the persisted run context.
2. **Real money.** A successful `/api/confirm` issues a real single-use card and completes a real
   purchase. Issue the card sized to the order total, **capped at the user-approved ceiling**.
3. **Units.** The order/receipt model carries dollar strings; the `agentcard` CLI takes **dollars**
   (`request new --amount 18.00`). Convert carefully; never under-fund (→ decline).
4. **Immutability.** Never mutate inputs; return new objects.
5. **Many small files.** 200–400 lines typical, 800 max. Organize by feature/domain.
6. **Errors handled explicitly.** No silent swallowing. Use the `TomoError` + `ErrorCodes` hierarchy
   (`packages/core`). User-facing messages in API responses; detailed context server-side.
7. **Site-agnostic.** Never build site-specific adaptors; the browser agent + discovery must be generic.

## Stack & commands

- **Language/build:** TypeScript, pnpm workspaces, `tsc`, Vitest. Packages are `@tomo/*`.
- **Funding:** `agentcard` consumer CLI (`npx -y agentcard@latest …`). One-time human setup required
  (`agentcard signup` + `setup` + `limit`) — the agent cannot do this. See `.claude/skills/agentcard/SKILL.md`.
- **Browser:** local Playwright Chrome (`channel: chrome`; `HEADLESS=false` for a visible window).
- **LLM:** OpenRouter (`OPENROUTER_API_KEY`, `AGENT_MODEL`, `INTENT_MODEL`).
- **Discovery:** Exa (`EXA_API_KEY`) + Playwright fetch + OpenRouter extraction.

```bash
pnpm install
pnpm build
pnpm test                       # all packages (unit)
pnpm test --filter @tomo/<pkg> # one package
```

## Package map

```
packages/
  core/           types, fees, JSON store (~/.tomo), config, error hierarchy
  crawling/       product discovery: Exa search + Playwright fetch + OpenRouter extraction
  checkout/       browser checkout: Playwright session, tool-calling Computer-Use Agent
                  (cua/loop.ts drives the page via a strong vision model; cua/tools.ts is the
                  internal tool registry — click/type/scroll + login/fill_card/fill_otp/
                  fill_shipping), CDP card-fill, confirmation detection, AGENTCARD funding,
                  credentials
  checkout-http/  HTTP checkout engine (deferred; browser path is the v1 path)
  identity/       agent identities + connected accounts: encrypted vault, Composio stub,
                  AgentMail inboxes, LLM login-strategy resolver (agent vs user account)
  orchestrator/   business logic: query() / buy() / confirm(); confirm() issues the Agentcard
  planner/        top-level planning agent: plan(task) over a capability registry; run()/resume()
                  execute steps with human-approval gates (create_account / session_token / purchase)
  api/            Hono REST server: /api/query, /api/buy, /api/confirm, /api/run (+ /approve)
docs/             user-facing API reference (docs/skill.md)
plans/            agentbuy design docs (internal)
_tomo-archive/    the original Tomo-buy backend + plans (reference only)
.env              local secrets (gitignored) — OpenRouter + Exa keys
```

## Security checklist (every checkout change)

- Card number/CVV/expiry filled via CDP only (`fill.ts` / `scripted-actions.ts`), never via the LLM.
- Login password/session token filled via direct Playwright only (`login.ts`), never via the LLM; both
  field names live in `CDP_FIELDS` (`credentials.ts`) and are read just-in-time from the vault.
- Agent-provided shipping data sanitized before becoming Stagehand/agent variables (`credentials.ts`).
- No real card/password/token value in any `console.log`, transcript, committed file, or `~/.tomo/runs.json`.
- `~/.tomo/vault.json` is encrypted at rest (AES-256-GCM under `VAULT_KEY`).
- Issued Agentcard amount ≤ approved ceiling, ≥ expected merchant total.
```
