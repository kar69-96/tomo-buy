#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRAWLING_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$CRAWLING_DIR/.firecrawl.pid"
ADAPTER_PID_FILE="$CRAWLING_DIR/.adapter.pid"

# ---- Stop Browserbase adapter ----
if [ -f "$ADAPTER_PID_FILE" ]; then
  APID=$(cat "$ADAPTER_PID_FILE")
  if kill -0 "$APID" 2>/dev/null; then
    echo "Stopping Browserbase adapter (PID $APID)..."
    kill "$APID"
    echo "Adapter stopped."
  else
    echo "Adapter process $APID not running. Cleaning up PID file."
  fi
  rm -f "$ADAPTER_PID_FILE"
else
  # Try to find and kill by port
  APID=$(lsof -ti :${ADAPTER_PORT:-3003} 2>/dev/null || true)
  if [ -n "$APID" ]; then
    echo "Found adapter process $APID on port ${ADAPTER_PORT:-3003}, stopping..."
    kill "$APID"
    echo "Adapter stopped."
  fi
fi

# ---- Stop Firecrawl ----

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping Firecrawl (PID $PID)..."
    kill "$PID"
    rm -f "$PID_FILE"
    echo "Firecrawl stopped."
  else
    echo "Firecrawl process $PID not running. Cleaning up PID file."
    rm -f "$PID_FILE"
  fi
else
  echo "No PID file found. Firecrawl may not be running."
  # Try to find and kill by port
  PID=$(lsof -ti :${FIRECRAWL_PORT:-3002} 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "Found process $PID on port ${FIRECRAWL_PORT:-3002}, stopping..."
    kill "$PID"
    echo "Stopped."
  fi
fi
