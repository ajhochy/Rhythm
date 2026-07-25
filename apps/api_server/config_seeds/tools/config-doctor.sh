#!/usr/bin/env bash
# Config Doctor (standalone) — triage opencode/Rhythm agent-config problems from a
# terminal, EVEN WHEN the in-app config-doctor agent can't start (a FATAL profile
# takes the whole engine config load down, so every session hangs on "Starting" —
# including config-doctor itself). Run this instead:
#
#   bash ~/.config/opencode/tools/config-doctor.sh
#
# It performs the Detect + Classify steps of the config-doctor runbook and tells you
# exactly which profile is fatal and what to do. It does NOT edit anything.
set -uo pipefail

CONF="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
ENGINE="${RHYTHM_OPENCODE_ENGINE:-http://127.0.0.1:4096}"
PROXY="${RHYTHM_AGENT_URL:-http://localhost:4001}"

echo "== Config Doctor (standalone) =="
echo "config dir: $CONF"
echo

echo "-- Detect: is the running engine healthy? --"
echo "engine POST $ENGINE/config/reload :"
curl -s -m 15 -XPOST "$ENGINE/config/reload" | head -c 700; echo
echo "proxy GET  $PROXY/opencode/mcp :"
code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$PROXY/opencode/mcp" 2>/dev/null || echo 000)"
echo "  HTTP $code"
case "$code" in
  200) echo "  healthy: MCP list returned" ;;
  502) echo "  UNHEALTHY: 502 = config load is failing (a FATAL profile), or a stale boot-time parse" ;;
  000) echo "  no response: the Rhythm agent server isn't running (app closed?)" ;;
  *)   echo "  unexpected status" ;;
esac
echo

echo "-- Classify: replay the loader over every agent profile --"
# Ensure js-yaml is resolvable for the classifier (bundled in this dir; app bundle is a fallback).
if ! node -e "require('$TOOLS/node_modules/js-yaml')" >/dev/null 2>&1 \
   && ! node -e "require('/Applications/Rhythm.app/Contents/Resources/api_server/node_modules/js-yaml')" >/dev/null 2>&1; then
  echo "provisioning js-yaml (one-time)…"
  ( cd "$TOOLS" && npm i --silent js-yaml@4 >/dev/null 2>&1 ) \
    || echo "  (npm install failed — run: cd $TOOLS && npm i js-yaml@4)"
fi
node "$TOOLS/classify.cjs" "$CONF/agents"
rc=$?
echo
if [ "$rc" -eq 1 ]; then
  echo "ACTION:"
  echo "  1. Fix the FATAL profile(s) above using the safe-frontmatter rules in"
  echo "     $CONF/agents/config-doctor.md (nested 'options', quoted \"*\" keys, mapping-form"
  echo "     permission sub-keys, no colon-space in plain scalars)."
  echo "  2. Re-run this script until no FATAL remains."
  echo "  3. QUIT AND REOPEN Rhythm — the engine only re-reads profiles on a fresh boot."
elif [ "$rc" -eq 0 ]; then
  echo "ACTION: profiles are clean. If the app still shows 502 / 'Starting', the running engine"
  echo "        is holding a stale boot-time parse — QUIT AND REOPEN Rhythm to load current files."
else
  echo "ACTION: classifier setup problem (see message above)."
fi
exit "$rc"
