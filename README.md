# This is agentbuy!

A little side project I made so that my agent is able to research and purchase items on the internet via CLI. Can use a credit card, or a USDC wallet for your agent.

My favorite use case: connect to the Skyscanner and Omio API to find the best train and flight combinations, then monitor prices and buy when it reaches a good price. 

btw: still a bit buggy and hits edge cases. 

If interested, prompt Claude code to clone this repo and visit Claude.md for context!

## New: per-domain caching

After a checkout works, agentbuy stashes the *safe* state for that site — non-auth cookies + localStorage — and replays it the next time it visits, so it can skip re-login and re-discovery. Anything that looks like a session/auth/token cookie is filtered out by name and never cached.

There are two ways it does this, depending on which browser tooling you're running (see below):

- **Debugging tooling** → a simple file cache at `~/.tomo/cache/{domain}.json`. The agent extracts the safe cookies + localStorage with Playwright and re-injects them on the next run.
- **Ideal tooling** → a [Browserbase Context](https://docs.browserbase.com/features/contexts): a server-side persistent browser profile, one per domain, that Browserbase reloads automatically. The cookies/localStorage never leave the cloud browser. (Wired up + stubbed — dormant unless you set the Browserbase keys.)

## Ideal vs debugging tooling

The repo runs out of the box on **debugging tooling** — the local, watch-it-happen stack I use while building and hitting edge cases. Every piece also has an **ideal** (production-grade) counterpart wired in behind an env switch; unset keys just fall back to the debugging default, so you can flip them on one at a time.

| Role | Debugging tooling (default) | Ideal tooling |
|---|---|---|
| Browser runtime | **local Chrome via Playwright** (`HEADLESS=false` to watch) | **[Browserbase](https://www.browserbase.com/)** managed stealth browsers |
| Per-domain cache | **file cache** (`~/.tomo/cache/{domain}.json`) | **Browserbase Contexts** (server-side persistent profile) |
| In-checkout browser agent | **OpenRouter** | **Gemini** (fast/cheap action-selection) |
| Orchestrator / planner | **OpenRouter** (`gpt-4o-mini` class) | **Claude Opus** |
| Funding | **[Agentcard](https://agentcard.to)** single-use cards | same |
| Agent email + OTP | placeholder inbox | **[AgentMail](https://agentmail.to)** disposable inboxes |
| Connected email | — | **[Composio](https://composio.dev)** (OTP + account detection) |

Flip a piece to its ideal counterpart with an env switch:

```bash
BROWSER_RUNTIME=browserbase   # + BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID
LLM_PROVIDER=gemini           # + GEMINI_API_KEY
PLANNER_MODEL=anthropic/claude-opus-4-8
COMPOSIO_API_KEY=...          # connected-email OTP
AGENTMAIL_API_KEY=...         # agent-identity inboxes
```

## Setup

```bash
pnpm install
pnpm build
cp .env.example .env      # then fill in the keys below
pnpm dev                  # starts the API on http://localhost:3000
```

### Required keys (`.env`)

- `OPENROUTER_API_KEY` — LLM for discovery + the browser agent
- `EXA_API_KEY` — natural-language product search
- `VAULT_KEY` — long random string; encrypts the local secret vault (`~/.tomo/vault.json`)

### One-time funding setup (human only)

Single-use cards come from the `agentcard` CLI, which needs a one-time human signup the agent can't do:

```bash
npx -y agentcard@latest signup
npx -y agentcard@latest setup
npx -y agentcard@latest limit
```

Then set `FUNDING=agentcard` in `.env`. See `.claude/skills/agentcard/SKILL.md` for details.

---

**Recommended flow:** `query` → `buy` → human approval → `confirm`. A successful `/api/confirm` (or an approved `/api/run` purchase gate) **spends real money.** Full API reference in [`docs/skill.md`](docs/skill.md).
