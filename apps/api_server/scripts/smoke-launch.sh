#!/usr/bin/env bash
# Smoke test: prove the api_server build + spawn pipeline actually works.
#
# What this asserts (NOT "fix is implemented"):
#   1. Node sentinel exists and points to an executable.
#   2. better-sqlite3 .node binary loads under that sentinel Node (ABI match).
#   3. dist/server.js exists (build artifact present).
#   4. Spawning the server with the sentinel Node + AGENT_LOCAL=true binds
#      :4001 and answers /health within 25s — same path Rhythm.app uses.
#   5. /agents/capabilities returns 200.
#   6. POST /agent-sessions with a taskId not in local DB does NOT 500
#      (PR #619 regression). 201 or 400-engine-not-ready both pass.
#
# Exit codes:
#   0  PASS
#   1  build/sentinel/ABI prerequisite failure
#   2  server failed to bind :4001
#   3  capabilities or session POST failed acceptance
#
# Usage: bash apps/api_server/scripts/smoke-launch.sh
set -uo pipefail
# Enable job control so the background spawn lives in its own process group;
# this lets us kill the whole tree (including the Opencode SDK's child node
# server) on cleanup. Without this the Opencode child reparents to launchd
# and keeps :4001 bound — causing the next Rhythm.app launch to "reuse" a
# stale server pointing at the wrong DB.
set -m

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$API_SERVER_DIR/../.." && pwd)"
SENTINEL="$API_SERVER_DIR/.node-runtime.json"
DIST="$API_SERVER_DIR/dist/server.js"
LOG_DIR="/tmp/rhythm-smoke"
LOG="$LOG_DIR/api-server.log"
# Isolated DB so smoke can never overwrite the user's real data at
# ~/Library/Application Support/Rhythm/rhythm.db.
SMOKE_DB="$LOG_DIR/smoke.db"
mkdir -p "$LOG_DIR"
rm -f "$SMOKE_DB" "$SMOKE_DB-shm" "$SMOKE_DB-wal"

fail() { echo "❌ FAIL: $*"; exit "${2:-1}"; }
ok()   { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

cleanup() {
  if [ -n "${SPAWN_PID:-}" ]; then
    # Kill the whole process group so the Opencode SDK child node dies too.
    kill -- "-$SPAWN_PID" 2>/dev/null || kill "$SPAWN_PID" 2>/dev/null || true
    sleep 1
    kill -9 -- "-$SPAWN_PID" 2>/dev/null || kill -9 "$SPAWN_PID" 2>/dev/null || true
  fi
  # Belt-and-suspenders: nuke anything still bound to :4001 that we spawned.
  STRAY=$(lsof -iTCP:4001 -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$STRAY" ]; then
    info "cleanup: killing stray :4001 listener(s) $STRAY"
    kill -9 $STRAY 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 0. Free :4001 (kill any orphan)
ORPHAN=$(lsof -iTCP:4001 -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "$ORPHAN" ]; then
  info "killing existing :4001 listener(s): $ORPHAN"
  kill $ORPHAN 2>/dev/null || true
  sleep 2
fi

# 1. Sentinel present
[ -f "$SENTINEL" ] || fail "$SENTINEL missing — run apps/api_server postinstall"
NODE_PATH=$(/usr/bin/env node -e "console.log(require('$SENTINEL').nodePath)" 2>/dev/null)
NODE_ABI=$(/usr/bin/env node -e "console.log(require('$SENTINEL').abi)" 2>/dev/null)
[ -x "$NODE_PATH" ] || fail "sentinel nodePath not executable: $NODE_PATH"
ok "sentinel: $NODE_PATH (ABI $NODE_ABI)"

# 2. better-sqlite3 ABI match under sentinel Node
"$NODE_PATH" -e "
  const p='$REPO_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node';
  try { process.dlopen({exports:{}}, p); }
  catch(e){ console.error(e.message.split('\\n')[0]); process.exit(2); }
" 2>/tmp/rhythm-smoke/abi-err || fail "better-sqlite3 ABI mismatch under sentinel Node: $(cat /tmp/rhythm-smoke/abi-err)"
ok "better-sqlite3 loads under sentinel Node"

# 3. dist build artifact
[ -f "$DIST" ] || fail "$DIST missing — run 'cd apps/api_server && npm run build'"
ok "dist/server.js present"

# 4. Spawn the server exactly like Rhythm.app does
info "spawning: $NODE_PATH $DIST (PORT=4001 AGENT_LOCAL=true DB_PATH=$SMOKE_DB)"
( cd "$API_SERVER_DIR" && AGENT_LOCAL=true PORT=4001 DB_PATH="$SMOKE_DB" "$NODE_PATH" "$DIST" >"$LOG" 2>&1 ) &
SPAWN_PID=$!
info "pid=$SPAWN_PID waiting for :4001 (25s budget)"

deadline=$(( $(date +%s) + 25 ))
while true; do
  if curl -fsS -o /dev/null --max-time 1 http://localhost:4001/health; then
    break
  fi
  if ! kill -0 "$SPAWN_PID" 2>/dev/null; then
    echo "--- api_server log tail ---"
    tail -50 "$LOG"
    fail "server crashed before /health responded" 2
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "--- api_server log tail ---"
    tail -50 "$LOG"
    fail "server did not bind :4001 within 25s" 2
  fi
  sleep 0.5
done
ok "server bound :4001 and answered /health"

# 5. /agents/capabilities
CAPS=$(curl -sS -w "\n%{http_code}" http://localhost:4001/agents/capabilities)
CAPS_CODE=$(echo "$CAPS" | tail -1)
[ "$CAPS_CODE" = "200" ] || fail "/agents/capabilities returned $CAPS_CODE" 3
ok "/agents/capabilities → 200"

# 6. PR #619 regression: POST with bogus taskId must NOT 500
BODY=$(cat <<EOF
{"agentId":"claude-code","name":"smoke-619","cwd":"$HOME","taskId":"definitely-not-in-local-db","taskTitle":"Synthetic"}
EOF
)
RESP=$(curl -sS -w "\n%{http_code}" -X POST http://localhost:4001/agent-sessions \
  -H "Content-Type: application/json" -d "$BODY")
SESS_CODE=$(echo "$RESP" | tail -1)
SESS_BODY=$(echo "$RESP" | sed '$d')
case "$SESS_CODE" in
  500)
    echo "$SESS_BODY"
    fail "POST /agent-sessions with bogus taskId returned 500 — FK regression" 3
    ;;
  201)
    ok "POST /agent-sessions → 201 (session created end-to-end)"
    ;;
  400)
    ok "POST /agent-sessions → 400 (expected when Opencode not authed — FK path is past)"
    ;;
  *)
    echo "$SESS_BODY"
    fail "POST /agent-sessions returned unexpected HTTP $SESS_CODE" 3
    ;;
esac

echo
ok "ALL CHECKS PASSED — build + spawn + bind + agent-session FK path verified"
echo "log: $LOG"
exit 0
