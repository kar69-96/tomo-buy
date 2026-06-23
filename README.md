# Tomo-buy

An agentic purchasing API: give it a product URL or a natural-language task, and it discovers the item, quotes it, and drives a real browser checkout — paying with a single-use virtual card minted per purchase. The LLM never sees a card number, password, or session token.

## How it works

You hand it an intent; the **orchestrator/planner** turns it into a plan, runs the plan, and returns the best result (a quote, a receipt, or a human-approval gate). Depending on the task, it takes one of three paths:

| Path | Trigger | What happens |
|---|---|---|
| **API / MCP purchase** | `POST /api/query → /api/buy → /api/confirm` | Direct browser checkout from a URL + shipping you provide. No account needed. Guest checkout. |
| **Headless purchase — agent identity** | `POST /api/run` (task) | The planner spins up the agent's *own* account (own email inbox, signup, login), then checks out. For anything where any account works. |
| **Headless purchase — your account** | `POST /api/run` (task) | The planner logs in as *you* via a session token (or email OTP), then checks out. For loyalty accounts, existing carts, your personal flights/orders. |

The planner composes three capabilities — `discover` → `login` → `purchase` — and pauses at **approval gates** before anything irreversible: `create_account` (register a new agent account), `session_token` (log in as you), and `purchase_confirm` (full price breakdown before a card is issued and real money moves).

## Core features

**1. Email OTP, end to end.** Agent identities get disposable [AgentMail](https://agentmail.to) inboxes; the login executor polls for the verification email, extracts the code, and fills it — no human in the loop. The user's own account is handled the same way by reading OTP from the connected inbox.

**2. Per-domain caching.** After a successful checkout, safe cookies + localStorage are saved per domain (`~/.tomo/cache/{domain}.json`) and replayed on the next visit, so the agent skips re-login and re-discovery. Auth/session cookies are filtered out by name — they never touch the cache.

**3. Single-use virtual cards.** Every purchase mints a fresh [Agentcard](https://agentcard.to) virtual card, sized to the order total (+ a tax/shipping buffer) and hard-capped at a ceiling you set. Real money, minimal exposure — the card is dead after one use, and its PAN/CVV are injected straight into the page via Playwright CDP, never through the model or any log.

## Setup

### Recommended tooling

| Role | Recommended | Why |
|---|---|---|
| Orchestrator / planner agent | **Claude Opus** | Deepest reasoning for plan composition and identity strategy. |
| Browser runtime | **[Browserbase](https://www.browserbase.com/) (stealth mode)** | Managed stealth browsers that survive bot detection at scale. |
| In-checkout browser agent | **Gemini** | Fast, cheap action-selection on the page loop. |
| Funding | **[Agentcard](https://agentcard.to)** | Single-use virtual cards, minted per purchase and capped at your ceiling. |
| Agent email + OTP | **[AgentMail](https://agentmail.to)** | Disposable inboxes per agent identity for signup and OTP. |
| Your connected email | **[Composio](https://composio.dev)** | Read OTP and detect existing accounts on the user's own inbox. |

> The repo currently ships with sensible local defaults — **OpenRouter** models + **local Playwright Chrome** — so it runs out of the box. The stack above is what we'd reach for in production.

### Install & run

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

### Optional

- `AGENTMAIL_API_KEY` — agent-identity inboxes + email OTP (without it, identities use a placeholder email and skip OTP)
- `COMPOSIO_API_KEY` — read OTP / detect accounts on the user's connected email
- `HEADLESS=false` — watch the checkout in a visible Chrome window

---

**Recommended flow:** `query` → `buy` → human approval → `confirm`. A successful `/api/confirm` (or an approved `/api/run` purchase gate) **spends real money.** Full API reference in [`docs/skill.md`](docs/skill.md).
