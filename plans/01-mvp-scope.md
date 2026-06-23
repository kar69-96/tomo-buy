# MVP Scope — Bloon v1

## One-Liner

REST API that lets AI agents purchase anything on the internet using credit card via browser checkout. No API keys. No registration. Any agent, any framework.

## What's In

### Core API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/query` | Discover product info, options, and required fields |
| `POST` | `/api/buy` | Get a purchase quote for any URL |
| `POST` | `/api/confirm` | Execute purchase via browser checkout, return receipt |

### Zero-Friction Access

- No API keys. No registration. No auth headers.
- Single operator model — the operator's credit card is configured in `.env`.
- Any agent that can make HTTP requests can use Bloon immediately.

### Payment Method

- **Credit card via browser checkout** — Browserbase + Stagehand with Playwright CDP credential fills. **2% fee.**
- The operator's card details are stored in `.env` and never exposed to the LLM.

### Product Discovery (`POST /api/query`)

- URL-only (v1) — agent provides a direct product URL
- Multi-tier discovery pipeline: Firecrawl (primary, up to 3 attempts + Browserbase+Gemini repair) → Exa.ai (Stage 2.5, parallel) → Server-side scrape (JSON-LD/meta tags) → Browserbase+Stagehand (headless Chrome)
- Returns product name, price, image, variant options (color, size), and required fields (shipping, selections)
- `POST /api/query` is the recommended first step — discover what a product needs before buying
- Product search by description (Exa.ai) planned for v1.5

### Browser Checkout

- Browserbase cloud sessions (fresh per checkout)
- Stagehand (by Browserbase) with Claude Sonnet 4 for LLM-powered navigation
- Credential placeholder system — agent/LLM never sees real card numbers
- Domain-level page caching for repeat purchases (cookies, localStorage)
- Supports arbitrary websites

### Receipts

Every purchase produces a structured receipt:
- product name, URL, merchant
- price, fee, fee rate, total paid
- order number / confirmation ID
- timestamp

### Constraints

- US shipping only
- Single operator (your card in .env)
- Credit card checkout only (no wallets, no crypto)
- Closed source

## What's Out (v1)

- API key auth / registration flow
- MCP wrapper (planned v2)
- Product search by description (Exa.ai — planned v1.5)
- Spending controls / daily budgets
- Virtual cards (Stripe Issuing)
- International shipping
- Human approval workflows
- Credential encryption / vault
- Web dashboard
- Rate limiting / abuse prevention

## Success Criteria

An AI agent can:

1. `POST /api/query` with a product URL → discover product info, options, and required fields
2. `POST /api/buy` with a product URL + shipping + selections → get a quote
3. `POST /api/confirm` → purchase executes via browser checkout, receipt returned
4. All testable with curl. No SDK, no client library, no auth.
