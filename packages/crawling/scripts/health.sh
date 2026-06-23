#!/usr/bin/env bash
set -euo pipefail

PORT="${FIRECRAWL_PORT:-3002}"

if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
  echo "Firecrawl is healthy on port $PORT"
  exit 0
else
  echo "Firecrawl is not responding on port $PORT"
  exit 1
fi
