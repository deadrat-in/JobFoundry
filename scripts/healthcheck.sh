#!/usr/bin/env bash
# scripts/healthcheck.sh — polls health check endpoints for JobFoundry All-in-One stack

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:8080/health}"
WEB_URL="${WEB_URL:-http://localhost:8080}"

MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-2}"

check_endpoint() {
  local name="$1"
  local url="$2"
  echo "Checking $name at $url..."
  for i in $(seq 1 "$MAX_RETRIES"); do
    if curl -fsSL "$url" > /dev/null 2>&1; then
      echo "  ✔ $name is healthy"
      return 0
    fi
    echo "  waiting for $name ($i/$MAX_RETRIES)..."
    sleep "$RETRY_INTERVAL"
  done
  echo "  ✖ $name failed health check"
  return 1
}

echo "Starting JobFoundry health check polling..."
check_endpoint "jobfoundry-api" "$HEALTH_URL"
check_endpoint "web-dashboard" "$WEB_URL"
echo "All JobFoundry services are healthy!"
