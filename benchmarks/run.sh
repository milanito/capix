#!/usr/bin/env bash
# Benchmark Capix vs Express, Fastify, and Hono.
# Usage: bash benchmarks/run.sh
# Requires: pnpm install in the benchmarks/ directory first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$SCRIPT_DIR/node_modules/.bin"
TOKEN="benchmark-token"

# Run all servers from benchmarks/ so pnpm node_modules are on the path
cd "$SCRIPT_DIR"

# Kill any leftover processes from a previous run
for port in 3000 3001 3002 3003; do
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 0.5

echo "Starting servers..."
"$BIN/tsx" servers/capix.ts &
CAPIX_PID=$!
node servers/express.js &
EXPRESS_PID=$!
node servers/fastify.js &
FASTIFY_PID=$!
node servers/hono.js &
HONO_PID=$!

cleanup() {
  kill $CAPIX_PID $EXPRESS_PID $FASTIFY_PID $HONO_PID 2>/dev/null || true
}
trap cleanup EXIT

sleep 2

run() {
  local label="$1"
  local url="$2"
  local auth="${3:-}"
  echo ""
  echo "  [$label]"
  if [ -n "$auth" ]; then
    "$BIN/autocannon" -c 100 -d 10 --json -H "Authorization: Bearer $auth" "$url"
  else
    "$BIN/autocannon" -c 100 -d 10 --json "$url"
  fi \
    | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const p = d.latency;
console.log('  req/s: ' + d.requests.average.toFixed(0) +
  '  p50: ' + p.p50 + 'ms  p99: ' + p.p99 + 'ms');
"
}

echo ""
echo "=== Scenario 1: Hello World (pure framework overhead) ==="
run "Capix"   "http://localhost:3000/hello"
run "Express" "http://localhost:3001/hello"
run "Fastify" "http://localhost:3002/hello"
run "Hono"    "http://localhost:3003/hello"

echo ""
echo "=== Scenario 2: Typed Input + Zod Validation ==="
run "Capix"   "http://localhost:3000/users/1"
run "Express" "http://localhost:3001/users/1"
run "Fastify" "http://localhost:3002/users/1"
run "Hono"    "http://localhost:3003/users/1"

echo ""
echo "=== Scenario 3: Auth Header + Guard ==="
run "Capix"   "http://localhost:3000/profile" "$TOKEN"
run "Express" "http://localhost:3001/profile" "$TOKEN"
run "Fastify" "http://localhost:3002/profile" "$TOKEN"
run "Hono"    "http://localhost:3003/profile" "$TOKEN"

echo ""
echo "Done."
