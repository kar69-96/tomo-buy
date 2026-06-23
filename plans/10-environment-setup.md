# Environment Setup — Bloon v1

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)

## .env.example

```env
# ---- Payment Credentials (never exposed to LLM) ----
CARD_NUMBER=4111111111111111
CARD_EXPIRY=12/25
CARD_CVV=123
CARDHOLDER_NAME=John Doe

# ---- Billing Address ----
BILLING_STREET=123 Main St
BILLING_CITY=Austin
BILLING_STATE=TX
BILLING_ZIP=78701
BILLING_COUNTRY=US

# ---- Shipping ----
# No default shipping. Shipping must be provided per-purchase in the buy request.
# Browser route purchases for physical items will fail with SHIPPING_REQUIRED if omitted.

# ---- API Keys ----
ANTHROPIC_API_KEY=sk-ant-...
BROWSERBASE_API_KEY=bb_live_...
BROWSERBASE_PROJECT_ID=proj_...
FIRECRAWL_API_KEY=fc-...           # Optional. Enables Firecrawl as primary discovery tier.
GOOGLE_API_KEY=...                 # For Stagehand LLM (Gemini 2.5 Flash)
AGENTMAIL_API_KEY=am_...           # Optional. AgentMail API key for checkout email verification codes.

# ---- Server ----
PORT=3000

# ---- Firecrawl Discovery Pipeline ----
FIRECRAWL_BASE_URL=http://localhost:3002   # Self-hosted default. Set to https://api.firecrawl.dev for cloud.
QUERY_MIN_CONFIDENCE=0.75                  # Min confidence to accept Firecrawl candidate without Browserbase fallback
QUERY_FIRECRAWL_TIMEOUT_MS=90000           # Per-attempt timeout for Firecrawl /v1/scrape
QUERY_MAX_VARIANT_URLS=12                  # Max variant URLs to extract in Step 2

# ---- Browserbase Adapter (Firecrawl's Playwright microservice) ----
ADAPTER_PORT=3003                          # Port the Browserbase adapter listens on
ADAPTER_CONCURRENCY=8                      # Max concurrent Browserbase sessions in the adapter
ADAPTER_SESSION_RATE=4                     # Max session creations per second (token bucket)
ADAPTER_QUEUE_TIMEOUT_MS=15000             # Queue timeout waiting for a concurrency slot
ADAPTER_RATE_QUEUE_TIMEOUT_MS=12000        # Queue timeout waiting for a rate limit token

# ---- Browserbase Fallback Extraction (Gemini) ----
BB_EXTRACT_CONCURRENCY=5                   # Max concurrent Browserbase fallback extractions
BB_EXTRACT_QUEUE_TIMEOUT_MS=15000          # Queue timeout for fallback extraction slots
GEMINI_EXTRACT_TIMEOUT_MS=20000            # Timeout for Gemini structured extraction call
GEMINI_EXTRACT_RETRIES=2                   # Number of Gemini extraction retries

# ---- Browserbase + Stagehand Variant Resolution (Tier 3) ----
QUERY_MAX_VARIANTS_PER_GROUP=3             # Max variants to resolve per option group
QUERY_MAX_TOTAL_VARIANT_TASKS=10           # Max total variant resolution tasks
QUERY_VARIANT_CONCURRENCY=3               # Concurrent Browserbase sessions for variant resolution
```

## Running the Server

```bash
# Install
pnpm install

# Build
pnpm -r build

# Start (production)
node packages/api/dist/index.js
# → Server running on http://localhost:3000

# Start (development, with hot reload)
pnpm --filter @bloon/api dev
```

## Data Directory

```
~/.bloon/
├── config.json       # Settings
├── orders.json       # All orders and receipts
└── cache/            # Domain page cache
    ├── amazon.com.json
    └── target.com.json
```

Created automatically on first run with `chmod 600`.

## pnpm Workspace

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

## TypeScript Base Config

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

## Testing the API

```bash
# Discover product info
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"url":"https://allbirds.com/products/mens-tree-runners"}'

# Get a purchase quote
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{"url":"https://target.com/p/...","shipping":{"name":"Test","street":"123 Main St","city":"Austin","state":"TX","zip":"78701","country":"US","email":"test@example.com","phone":"5551234567"}}'

# Execute purchase
curl -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{"order_id":"ORDER_ID"}'
```
