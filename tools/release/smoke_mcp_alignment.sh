#!/usr/bin/env bash
#
# #785 — MCP names-alignment + no-server-lost regression guard, verified against
# the ACTUAL built fork binary. The MCP analogue of smoke_skill_alignment.sh.
# Two invariants, both silent when violated:
#
#   1. NO SERVER LOST — a server configured in opencode.json's `mcp` block MUST
#      appear in the engine's live `GET /mcp` listing. The set of names IN
#      (the configured mcp keys) must be a subset of the set OUT (the live
#      listing). A proxy/config-writer regression that dropped a configured
#      server would fail here.
#
#   2. NAMES ALIGNMENT (#765/#781) — a name taken from the LIVE `GET /mcp` id set
#      round-trips through a per-session mcpAllowlist. This is the invariant that
#      makes #765 per-session scoping work: allowed_mcps_json names MUST equal the
#      engine's live server ids or scoping silently matches nothing (the #781
#      hazard: `ableton` vs `ableton-mcp`, `nfl-mcp` vs `nfl_mcp`, a leaked `foo`).
#
# On a binary whose proxy drops a configured server, or whose per-session
# mcpAllowlist write path is broken (the #765 shape), this exits non-zero and
# fails the build.
#
# Usage: smoke_mcp_alignment.sh <opencode-binary> [port]
set -euo pipefail

BIN="${1:?usage: smoke_mcp_alignment.sh <opencode-binary> [port]}"
PORT="${2:-4397}"
BASE="http://127.0.0.1:${PORT}"
WORKDIR="$(mktemp -d)"
HOME_DIR="${WORKDIR}/home"
SERVE_PID=""

cleanup() {
  [[ -n "${SERVE_PID}" ]] && kill "${SERVE_PID}" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}" || true
}
trap cleanup EXIT

fail() { echo "::error::$*" >&2; [[ -f "${WORKDIR}/serve.log" ]] && cat "${WORKDIR}/serve.log" >&2; exit 1; }

[[ -x "${BIN}" ]] || fail "opencode binary not executable: ${BIN}"

# opencode.json with two MCP servers configured (as api_server writes them at
# boot). They are local stdio servers pointed at a no-op command — we never
# connect them; the listing must still report them by id regardless of
# connection status (NO SERVER LOST applies to configured, not connected).
mkdir -p "${HOME_DIR}/.config/opencode"
cat >"${HOME_DIR}/.config/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rhythm-smoke": { "type": "local", "command": ["true"], "enabled": true },
    "ableton-mcp": { "type": "local", "command": ["true"], "enabled": true }
  }
}
EOF

export HOME="${HOME_DIR}"
export OPENCODE_TEST_HOME="${HOME_DIR}"

echo "Starting opencode serve on :${PORT} (HOME=${HOME_DIR}) ..."
"${BIN}" serve --hostname 127.0.0.1 --port "${PORT}" >"${WORKDIR}/serve.log" 2>&1 &
SERVE_PID=$!

ready=""
for _ in $(seq 1 60); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${BASE}/app" 2>/dev/null || true)" == "200" ]]; then
    ready=1; break
  fi
  kill -0 "${SERVE_PID}" 2>/dev/null || fail "opencode serve exited before becoming ready"
  sleep 0.5
done
[[ -n "${ready}" ]] || fail "opencode serve did not become ready on ${BASE}"

# 1. NO SERVER LOST — list MCP servers; the configured ids must all appear.
#    The engine's GET /mcp returns a status map keyed by server id.
LIST="$(curl -fsS "${BASE}/mcp?directory=${WORKDIR}")" || fail "GET /mcp failed"
printf '%s' "${LIST}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
# GET /mcp returns a map keyed by server id (status map). Tolerate either a
# dict (id -> entry) or a list of {name/id}.
if isinstance(d, dict):
    names = set(d.keys())
elif isinstance(d, list):
    names = {e.get("name") or e.get("id") for e in d}
else:
    print("::error::unexpected GET /mcp shape:", type(d).__name__); sys.exit(1)
configured = {"rhythm-smoke", "ableton-mcp"}
missing = configured - names
if missing:
    print("::error::configured MCP server(s) LOST from the live listing (no-server-lost regression):", sorted(missing), "live:", sorted(names)); sys.exit(1)
print("live mcp ids:", sorted(names))
' || fail "no-server-lost invariant failed (a configured MCP server disappeared from GET /mcp)"

# 2. NAMES ALIGNMENT (#765/#781) — a LIVE id round-trips through a per-session
#    mcpAllowlist. Use a configured id; a stale alias would silently match
#    nothing, so this proves the names line up end-to-end.
CREATE="$(curl -fsS -X POST "${BASE}/session?directory=${WORKDIR}" \
  -H 'Content-Type: application/json' -d '{"title":"mcp-alignment-guard"}')" \
  || fail "session create failed"
SID="$(printf '%s' "${CREATE}" | sed -n 's/.*"id":"\(ses_[^"]*\)".*/\1/p')"
[[ -n "${SID}" ]] || fail "could not parse session id: ${CREATE}"

CODE="$(curl -fsS -o /dev/null -w '%{http_code}' -X PATCH "${BASE}/session/${SID}?directory=${WORKDIR}" \
  -H 'Content-Type: application/json' -d '{"mcpAllowlist":{"servers":["rhythm-smoke"],"tools":[]}}')" \
  || fail "PATCH mcpAllowlist failed"
[[ "${CODE}" == "200" ]] || fail "PATCH returned HTTP ${CODE}"

GET="$(curl -fsS "${BASE}/session/${SID}?directory=${WORKDIR}")" || fail "GET session failed"
printf '%s' "${GET}" | python3 -c '
import sys, json
al = json.load(sys.stdin).get("mcpAllowlist")
if not al or al.get("servers") != ["rhythm-smoke"]:
    print("::error::live MCP server id did not round-trip through mcpAllowlist (#765/#781):", json.dumps(al)); sys.exit(1)
' || fail "names-alignment invariant failed (#765/#781)"

echo "OK: no-server-lost + names-alignment guards passed."
