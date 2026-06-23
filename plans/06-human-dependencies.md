# Human Dependencies — Bloon v1

Things the human operator needs to set up or provide before/during the build.

---

## Before Building

| Dependency | Status | Notes |
|-----------|--------|-------|
| Node.js 20+ | Required | Runtime |
| pnpm 9+ | Required | `npm install -g pnpm` |
| Google API key (`GOOGLE_API_KEY`) | Required | For Gemini (Stagehand checkout LLM) |
| Google API key (`GOOGLE_API_KEY_QUERY`) | Required | For Gemini 2.5 Flash (Firecrawl extraction + Browserbase fallback in discovery). Can be same as GOOGLE_API_KEY. |
| Browserbase account | Required | API key + project ID for cloud browser sessions (Tier 3 discovery + checkout) |
| Firecrawl API key | Optional | Enables Firecrawl as primary discovery tier. Defaults to `fc-selfhosted` for local. Without it, falls back to scrape → Browserbase. |
| Exa.ai API key (`EXA_API_KEY`) | Optional | Enables Exa.ai Stage 2.5 discovery (parallel with Firecrawl). Skipped if not set. |
| Credit card for testing | Required | Real or test card info in .env (`CARD_*` vars) |
| Shipping address for testing | Recommended | Provide in each buy request — no .env default |

## During Testing

| Dependency | Status | Notes |
|-----------|--------|-------|
| Credit card credentials | Required | `CARD_NUMBER`, `CARD_EXPIRY`, `CARD_CVV`, `CARDHOLDER_NAME` in .env |
| Billing address | Required | `BILLING_STREET`, `BILLING_CITY`, etc. in .env |
| Browserbase sessions | Required | For browser checkout and Tier 3 discovery |

## Before Production (v1.5+)

| Dependency | Status | Notes |
|-----------|--------|-------|
| HTTPS / reverse proxy | Future | nginx or Cloudflare tunnel for production |
| Domain name | Future | For hosted version |
| API key auth enabled | Future | Before any public-facing deployment |

---

## Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| MCP vs API | API-first (REST via Hono). MCP wrapper in v2. |
| Auth model | No auth for v1. API key auth in v1.5. |
| Payment method | Credit card via Playwright CDP (no blockchain/USDC). |
| Product search | URL-only for v1. Exa.ai in v1.5. |
| Browser LLM | Claude Sonnet 4 |
| Session strategy | Fresh Browserbase sessions + domain page caching |
| Shipping handling | Custom per-purchase. SHIPPING_REQUIRED error if missing. |
| Source code | Closed source |
