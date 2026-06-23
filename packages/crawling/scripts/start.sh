#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRAWLING_DIR="$(dirname "$SCRIPT_DIR")"
FIRECRAWL_DIR="$CRAWLING_DIR/firecrawl/apps/api"

if [ ! -d "$FIRECRAWL_DIR" ]; then
  echo "Error: Firecrawl submodule not found at $FIRECRAWL_DIR"
  echo "Run: cd packages/crawling && git submodule update --init"
  exit 1
fi

# ---- LLM provider preflight ----
FIRECRAWL_LLM_PROVIDER="${FIRECRAWL_LLM_PROVIDER:-auto}" # auto|google|openai
FIRECRAWL_LLM_KEY="${GOOGLE_API_KEY_QUERY:-${GOOGLE_API_KEY:-}}"
FIRECRAWL_OPENAI_KEY="${FIRECRAWL_OPENAI_API_KEY:-${OPENAI_API_KEY:-}}"
FIRECRAWL_OPENAI_BASE="${FIRECRAWL_OPENAI_BASE_URL:-${OPENAI_BASE_URL:-}}"

if [ "$FIRECRAWL_LLM_PROVIDER" = "google" ] && [ -z "$FIRECRAWL_LLM_KEY" ]; then
  echo "Error: FIRECRAWL_LLM_PROVIDER=google but GOOGLE_API_KEY_QUERY/GOOGLE_API_KEY is missing"
  exit 1
fi
if [ "$FIRECRAWL_LLM_PROVIDER" = "openai" ]; then
  if [ -z "$FIRECRAWL_OPENAI_KEY" ]; then
    echo "Error: FIRECRAWL_LLM_PROVIDER=openai but OPENAI_API_KEY/FIRECRAWL_OPENAI_API_KEY is missing"
    exit 1
  fi
  if [[ "$FIRECRAWL_OPENAI_KEY" != sk-* ]] && [ -z "$FIRECRAWL_OPENAI_BASE" ]; then
    echo "Error: openai-compatible key requires OPENAI_BASE_URL/FIRECRAWL_OPENAI_BASE_URL"
    exit 1
  fi
fi
if [ "$FIRECRAWL_LLM_PROVIDER" = "auto" ] && [ -z "$FIRECRAWL_LLM_KEY" ] && [ -z "$FIRECRAWL_OPENAI_KEY" ]; then
  echo "Error: no LLM credentials found. Set GOOGLE_API_KEY_QUERY/GOOGLE_API_KEY or OPENAI_API_KEY"
  exit 1
fi

if [ -n "$FIRECRAWL_OPENAI_BASE" ] && [[ ! "$FIRECRAWL_OPENAI_BASE" =~ ^https?:// ]]; then
  echo "Error: OPENAI_BASE_URL must start with http:// or https://"
  exit 1
fi

# ---- Start Browserbase adapter (Playwright microservice for Firecrawl) ----
ADAPTER_PORT="${ADAPTER_PORT:-3003}"
echo "Starting Browserbase adapter on port $ADAPTER_PORT..."

if [ -z "${BROWSERBASE_API_KEY:-}" ] || [ -z "${BROWSERBASE_PROJECT_ID:-}" ]; then
  echo "Warning: BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID not set — adapter will not start"
  echo "  Firecrawl will use fetch-only engine (no JS rendering)"
else
  ADAPTER_PORT="$ADAPTER_PORT" npx tsx "$CRAWLING_DIR/src/browserbase-adapter.ts" &
  ADAPTER_PID=$!
  echo "Browserbase adapter PID: $ADAPTER_PID"
  echo "$ADAPTER_PID" > "$CRAWLING_DIR/.adapter.pid"

  # Wait for adapter health
  for i in $(seq 1 15); do
    if curl -sf "http://localhost:$ADAPTER_PORT/health" > /dev/null 2>&1; then
      echo "Browserbase adapter is ready on port $ADAPTER_PORT"
      break
    fi
    sleep 1
  done

  export PLAYWRIGHT_MICROSERVICE_URL="http://localhost:$ADAPTER_PORT/scrape"
  echo "  PLAYWRIGHT_MICROSERVICE_URL=$PLAYWRIGHT_MICROSERVICE_URL"
fi

# ---- Start Firecrawl API ----
echo ""
echo "Starting Firecrawl API from source..."
echo "  Directory: $FIRECRAWL_DIR"
echo "  Port: ${FIRECRAWL_PORT:-3002}"

cd "$FIRECRAWL_DIR"

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Export env vars for Firecrawl
export PORT="${FIRECRAWL_PORT:-3002}"
export USE_DB_AUTHENTICATION=false
export MODEL_NAME="${FIRECRAWL_MODEL:-gemini-2.5-flash}"
export MODEL_PROVIDER="${FIRECRAWL_LLM_PROVIDER_SDK:-google}"

# Provider matrix for Firecrawl generic-ai:
# - Google-native Gemini
# - OpenAI-compatible endpoints (OpenAI, OpenRouter-compatible adapters, etc.)
if [ -n "$FIRECRAWL_LLM_KEY" ]; then
  export GOOGLE_GENERATIVE_AI_API_KEY="$FIRECRAWL_LLM_KEY"
fi
if [ -n "$FIRECRAWL_OPENAI_KEY" ]; then
  export OPENAI_API_KEY="$FIRECRAWL_OPENAI_KEY"
fi
if [ -n "$FIRECRAWL_OPENAI_BASE" ]; then
  export OPENAI_BASE_URL="$FIRECRAWL_OPENAI_BASE"
fi

echo "LLM provider mode: $FIRECRAWL_LLM_PROVIDER"
if [ -n "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]; then
  echo "  Google Gemini key: configured"
fi
if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "  OpenAI-compatible key: configured"
fi
if [ -n "${OPENAI_BASE_URL:-}" ]; then
  echo "  OpenAI base URL: $OPENAI_BASE_URL"
fi

# Start the API server
echo "Starting on port $PORT..."
pnpm run start &
FIRECRAWL_PID=$!

echo "Firecrawl PID: $FIRECRAWL_PID"
echo "$FIRECRAWL_PID" > "$CRAWLING_DIR/.firecrawl.pid"

# Wait for health check
echo "Waiting for Firecrawl to be ready..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo "Firecrawl is ready on port $PORT"
    break
  fi
  sleep 1
done

if ! curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
  echo "Warning: Firecrawl did not respond to health check within 60s"
  echo "It may still be starting up. Check: curl http://localhost:$PORT/health"
  exit 1
fi

# ---- Startup smoke check: require structured JSON extraction ----
SMOKE_URL="${FIRECRAWL_SMOKE_URL:-https://www.allbirds.com/products/mens-tree-runners}"
echo "Running startup JSON extraction smoke check..."
SMOKE_RESPONSE="$(curl -sf "http://localhost:$PORT/v1/scrape" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FIRECRAWL_API_KEY:-fc-selfhosted}" \
  -d "{\"url\":\"$SMOKE_URL\",\"formats\":[\"json\"],\"jsonOptions\":{\"schema\":{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"},\"price\":{\"type\":\"string\"}}},\"prompt\":\"Extract product name and current selling price.\"},\"timeout\":30000,\"waitFor\":0}")"

node -e '
const raw = process.argv[1];
let body;
try { body = JSON.parse(raw); } catch { process.exit(2); }
const data = body?.data ?? {};
const extract = data?.json ?? data?.extract ?? null;
const ok = Boolean(extract?.name && extract?.price);
if (!ok) process.exit(3);
' "$SMOKE_RESPONSE" || {
  echo "Error: startup smoke check failed (missing json.name/json.price)."
  echo "This usually means Firecrawl LLM endpoint/provider configuration is invalid."
  exit 1
}

echo "Startup smoke check passed."
exit 0
