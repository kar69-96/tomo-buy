# Bloon

> **ARCHIVED (2026-03-19):** This document describes the original USDC/blockchain architecture. Bloon has been migrated to credit-card-only. See `CLAUDE.md` and `docs/skill.md` for the current architecture.

**Any website. Any product. One USDC payment. The agent handles the rest.**

Bloon is a REST API (TypeScript/Hono) that lets AI agents purchase anything on the internet using USDC on Base. No API keys. No registration. The agent's `wallet_id` is its credential. Bloon auto-routes payments — x402-native merchants get paid directly (2% fee), everything else goes through Browserbase cloud browser checkout with Stagehand (2% fee). Same interface, same receipt format either way.

The internet has two emerging payment layers for agents: x402 (for services that natively accept stablecoin over HTTP) and ACP (Stripe/OpenAI's protocol for opted-in merchants). But 99.9% of e-commerce speaks neither. Bloon bridges that gap — turning every checkout page on the web into an endpoint an agent can pay.

## v1 Scope

- **REST API** (Hono) with 5 JSON endpoints + 1 HTML funding page
- **No auth** — `wallet_id` is the spending credential, `funding_token` controls deposits
- **URL-only purchases** — agent provides a direct product URL (search by description deferred to v1.5)
- **Product discovery** — `POST /api/query` returns product info, variant options, per-variant prices, and required fields before buying
- **4-tier discovery pipeline**: Firecrawl (primary, 3 retries + Browserbase+Gemini repair) → Exa.ai (Stage 2.5, parallel) → Server-side scrape (JSON-LD/meta tags) → Browserbase+Stagehand
- **Two payment routes**: x402 (auto-detected, 2% fee) and browser checkout (2% fee)
- **Two-phase purchase**: `POST /api/buy` returns a quote, `POST /api/confirm` executes
- **Variant selections** — agent can specify product options (Color, Size) in the buy request
- **viem wallets** on Base (Sepolia for testnet, mainnet for prod) — no Coinbase CDP dependency
- **Private funding page** per wallet with QR code + live balance polling
- **Credential placeholder system** — LLM never sees real card numbers
- **12-step browser checkout** with Stagehand agent + custom tools (fillShippingInfo, fillCardFields, fillBillingAddress)
- **Fresh Browserbase sessions** per checkout, with domain-level page caching
- **$25 max** per transaction, US shipping only, buy-only wallets
- **JSON file storage** in `~/.bloon/` with atomic writes — no database
- **Closed source**, single operator

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/wallets` | Create wallet → `wallet_id` + `funding_url` |
| `GET` | `/api/wallets/:wallet_id` | Balance + transaction history |
| `POST` | `/api/query` | Discover product info, options, required fields (no wallet needed) |
| `POST` | `/api/buy` | Get purchase quote for any URL (does NOT spend) |
| `POST` | `/api/confirm` | Execute purchase → receipt |
| `GET` | `/fund/:token` | HTML funding page with QR code + live balance |

## Fee Model

- **x402-native merchants:** 2% fee (Bloon pays the service on behalf of the agent)
- **Non-x402 merchants (browser checkout):** 2% fee (covers Browserbase sessions, Stagehand LLM inference, and margin)
- **Gas costs** are covered by the fee — the agent only needs USDC, not ETH

The agent never sees the difference. One flow, one interface, one receipt format.

## How It Works

### 1. Create & Fund a Wallet

```
Agent: POST /api/wallets { "agent_name": "Shopping Agent" }
--> Returns: wallet_id + funding_url

Human opens funding_url --> QR code --> sends USDC on Base --> balance updates
```

### 2. Discover Product Info

```
Agent: POST /api/query { "url": "https://allbirds.com/products/mens-tree-runners" }

Server runs 4-tier discovery:
  1. Firecrawl (up to 3 attempts + Browserbase+Gemini repair if confidence < 0.75)
  2. Exa.ai (parallel with Firecrawl, best-effort)
  3. Server-side scrape (JSON-LD, meta tags)
  4. Browserbase + Stagehand (last resort)

--> Returns: product info, options (Color, Size), per-variant prices, required_fields, route
```

### 3. Get a Quote

```
Agent: POST /api/buy {
  "url": "https://allbirds.com/products/mens-tree-runners",
  "wallet_id": "...",
  "shipping": { ... },
  "selections": { "Color": "Charcoal", "Size": "10" }
}

--> Returns: order_id, product name/price, fee breakdown, route
```

### 4. Confirm & Purchase

```
Agent: POST /api/confirm { "order_id": "bloon_ord_9x2k4m" }

Server: transfers USDC from agent wallet --> Bloon master wallet
  - x402: pays service via @x402/fetch --> returns response + receipt
  - Browser: Browserbase session --> Stagehand 12-step checkout --> returns order number + receipt
```

Every purchase produces a structured receipt: product, merchant, route, price, fee, total, confirmation, timestamp.

## Payment Flow

```
+------------------------------------------+
|        AI Agent / curl / script           |
+-------------------+----------------------+
                    | HTTP (no auth)
+-------------------v----------------------+
|         Hono API (packages/api)           |
+-------------------+----------------------+
                    |
+-------------------v----------------------+
|       Orchestrator (packages/orchestrator)|
|  query() --> discovery pipeline           |
|  buy() --> route detection --> quote      |
|  confirm() --> USDC transfer --> execute  |
+-----+----------+-----------+-------------+
      |          |           |
+-----v--+ +----v----+ +----v--------------+
| wallet  | |  x402   | |  checkout         |
| viem    | | @x402/  | | Stagehand (Son 4) |
| USDC    | | fetch   | | Browserbase       |
| QR      | |         | | credentials       |
+---------+ +---------+ +----+------+-------+
                              |      |
                        +-----v-+ +--v---------+
                        |crawling| |  core      |
                        |Firecrawl | types,fees |
                        |Exa.ai  | | store      |
                        +--------+ +------------+
```

## Two Secrets Per Wallet

| Secret | Controls | If Leaked |
|--------|---------|-----------|
| `wallet_id` | Spending (buy, confirm) | Someone can spend the wallet's USDC |
| `funding_token` | Depositing (funding page) | Someone can send USDC to the wallet (harmless) |

These are independent — knowing one doesn't reveal the other.

## Tech Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| HTTP Server | Hono 4.x | REST API |
| Blockchain | viem 2.x | Wallets, USDC transfers, balances |
| x402 | @x402/fetch | Pay x402 services |
| Browser Automation | Stagehand | LLM-powered checkout (Sonnet 4) |
| Cloud Browser | Browserbase SDK | Remote sessions |
| Product Discovery | Firecrawl (self-hosted) | Primary extraction via /v1/scrape |
| Product Discovery | Exa.ai (exa-js) | Stage 2.5 parallel extraction |
| LLM (Checkout) | @anthropic-ai/sdk | Sonnet 4 for Stagehand |
| LLM (Discovery) | Gemini 2.5 Flash | Firecrawl extraction + Browserbase fallback |
| Gemini SDK | @google/generative-ai | Structured extraction |
| HTML Processing | cheerio + turndown | HTML --> Markdown for Browserbase fallback |
| QR Code | qrcode | PNG generation |

## Package Structure

```
packages/
+-- core/           # Types, fees, store (JSON persistence), config, concurrency pool
+-- orchestrator/   # Business logic: query, buy, confirm, routing, receipts
+-- wallet/         # viem wallet create, balance, QR, USDC transfer, gas
+-- x402/           # x402 detection + payment via @x402/fetch
+-- crawling/       # Product discovery: Firecrawl + Exa.ai + Browserbase+Gemini fallback
+-- checkout/       # Browserbase sessions, Stagehand, credentials, domain cache, discovery
+-- api/            # Hono server, routes, formatters, funding page HTML
```

## Security Model

| Threat | Mitigation |
|--------|-----------|
| LLM sees card numbers | Placeholder system — LLM sees `x_card_number`, real values injected via Playwright CDP |
| wallet_id leaked | Cryptographically random IDs. $25 cap. Testnet. API key auth in v1.5. |
| Failed purchases | tx_hash preserved immediately. Manual refund for v1. |
| Prompt injection | Structured REST endpoints. Stagehand gets deterministic task templates. |
| Runaway spending | $25 cap. Two-phase (buy then confirm). Balance re-checked at confirm time. |

## What's Deferred

- Product search by description (Exa.ai `/search`) --> v1.5
- Coinbase Onramp Guest Checkout --> v1.5
- API key auth --> v1.5
- Wallet key encryption --> v1.5
- MCP wrapper --> v2
- Multi-network/multi-currency --> v2
- Dashboard UI --> v2
- Multi-tenant --> v3

## Competitive Landscape

| Solution | What it does | Gap Bloon fills |
|----------|-------------|-----------------|
| x402 (Coinbase) | Native stablecoin payments over HTTP | Only works if the seller has integrated x402 |
| ACP (Stripe/OpenAI) | Agentic checkout for opted-in merchants | Only works for merchants in the ACP network |
| Sponge (YC) | Agent wallets + business gateway | Requires businesses to onboard; can't buy from arbitrary websites |
| **Bloon** | **Any URL. One USDC payment. Receipt back.** | **Bridges the 99.9% of the web that doesn't speak any agent protocol** |

---

Full specification in `/plans/01-20`. Agent-facing API reference in `/docs/skill.md`.
