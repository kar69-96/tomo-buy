# Tomo-buy — Agentic purchasing API (agentbuy core, Agentcard-funded)

> This file is the project's `/init` artifact. Every session — human or agent — inherits it.

## What this is

A REST backend that lets an AI agent **purchase anything on the internet** from a product URL or a
natural-language search. It discovers the product, quotes it, then drives a **local Chrome
(Playwright)** to complete checkout — paying with a **single-use virtual card issued by Agentcard**,
freshly minted per purchase and sized to the order total.

This codebase is a fork of [`kar69-96/agentbuy`](https://github.com/kar69-96/agentbuy) (codename
"Bloon"), rewired for this project:

| Concern | agentbuy upstream | This fork |
|---|---|---|
| Funding | Static card in `.env` | **Agentcard single-use cards** (CLI: issue → reveal → inject) |
| Browser | Browserbase cloud + Stagehand | **Local Playwright on Chrome** |
| LLM | Google Gemini | **OpenRouter** (key in `.env`) |
| Discovery | Firecrawl + Browserbase+Gemini | **Exa + Playwright + OpenRouter** |

The original Tomo-buy backend (Temporal/intent-router/vaults) is archived under `_tomo-archive/`.

## Prime directive (non-negotiable)

**The LLM never sees a card number.** Card PAN/CVV/expiry come from Agentcard and are injected into
the page **only via Playwright CDP** (`packages/checkout/src/fill.ts`). They never enter the LLM
prompt/response, never get logged, and never get written to a committed file. Shipping/contact PII is
sanitized before it goes to the LLM as `%var%`-style variables. This invariant is structural — any
change that routes a card value through the model or a log is wrong by construction.

## API (the three endpoints)

- `POST /api/query` — discover product options + required fields (URL or NL `query`)
- `POST /api/buy` — get a purchase quote for a URL (does NOT spend); returns an `order_id`
- `POST /api/confirm` — issue an Agentcard, run browser checkout, return a receipt (**spends real money**)

Recommended flow: `query` → `buy` → human approval → `confirm`.

## Rules

1. **Secrets never reach the LLM** (see Prime directive). The funding/card-reveal code path
   (`packages/checkout/src/agentcard.ts`) is the only place card details exist, and they flow
   straight into CDP injection.
2. **Real money.** A successful `/api/confirm` issues a real single-use card and completes a real
   purchase. Issue the card sized to the order total, **capped at the user-approved ceiling**.
3. **Units.** The order/receipt model carries dollar strings; the `agentcard` CLI takes **dollars**
   (`request new --amount 18.00`). Convert carefully; never under-fund (→ decline).
4. **Immutability.** Never mutate inputs; return new objects.
5. **Many small files.** 200–400 lines typical, 800 max. Organize by feature/domain.
6. **Errors handled explicitly.** No silent swallowing. Use the `BloonError` + `ErrorCodes` hierarchy
   (`packages/core`). User-facing messages in API responses; detailed context server-side.
7. **Site-agnostic.** Never build site-specific adaptors; the browser agent + discovery must be generic.

## Stack & commands

- **Language/build:** TypeScript, pnpm workspaces, `tsc`, Vitest. Packages are `@bloon/*`.
- **Funding:** `agentcard` consumer CLI (`npx -y agentcard@latest …`). One-time human setup required
  (`agentcard signup` + `setup` + `limit`) — the agent cannot do this. See `.claude/skills/agentcard/SKILL.md`.
- **Browser:** local Playwright Chrome (`channel: chrome`; `HEADLESS=false` for a visible window).
- **LLM:** OpenRouter (`OPENROUTER_API_KEY`, `AGENT_MODEL`, `INTENT_MODEL`).
- **Discovery:** Exa (`EXA_API_KEY`) + Playwright fetch + OpenRouter extraction.

```bash
pnpm install
pnpm build
pnpm test                       # all packages (unit)
pnpm test --filter @bloon/<pkg> # one package
```

## Package map

```
packages/
  core/           types, fees, JSON store (~/.bloon), config, error hierarchy
  crawling/       product discovery: Exa search + Playwright fetch + OpenRouter extraction
  checkout/       browser checkout: Playwright session, OpenRouter agent loop, CDP card-fill,
                  confirmation detection, AGENTCARD funding (agentcard.ts), credentials
  checkout-http/  HTTP checkout engine (deferred; browser path is the v1 path)
  orchestrator/   business logic: query() / buy() / confirm(); confirm() issues the Agentcard
  api/            Hono REST server: /api/query, /api/buy, /api/confirm
docs/             user-facing API reference (docs/skill.md)
plans/            agentbuy design docs (internal)
_tomo-archive/    the original Tomo-buy backend + plans (reference only)
.env              local secrets (gitignored) — OpenRouter + Exa keys
```

## Security checklist (every checkout change)

- Card number/CVV/expiry filled via CDP only (`fill.ts` / `scripted-actions.ts`), never via the LLM.
- Agent-provided shipping data sanitized before becoming Stagehand/agent variables (`credentials.ts`).
- No real card value in any `console.log`, transcript, or committed file.
- Issued Agentcard amount ≤ approved ceiling, ≥ expected merchant total.
```
