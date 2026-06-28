#!/usr/bin/env bash
#
# Regression guard for issue #765 (per-session MCP allowlist persistence).
#
# #765 was a false green: the api_server unit test mocked the engine, and the
# release CI only checked the fork's --version marker — nothing exercised the
# real PATCH /session/:id write path against a built binary. A later refactor
# removed the engine's allowlist write path, so PATCH returned 200 but silently
# dropped mcpAllowlist (the row / GET stayed null) and Secretary sessions saw
# every MCP server.
#
# This script runs the ACTUAL built binary, creates a session, PATCHes a
# per-session allowlist, and asserts it round-trips on GET. On the broken
# binary the GET is null and this exits non-zero, failing the build.
#
# Usage: smoke_mcp_allowlist.sh <opencode-binary> [port]
set -euo pipefail

BIN="${1:?usage: smoke_mcp_allowlist.sh <opencode-binary> [port]}"
PORT="${2:-4399}"
BASE="http://127.0.0.1:${PORT}"
WORKDIR="$(mktemp -d)"
SERVE_PID=""

cleanup() {
  [[ -n "${SERVE_PID}" ]] && kill "${SERVE_PID}" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}" || true
}
trap cleanup EXIT

fail() { echo "::error::$*" >&2; [[ -f "${WORKDIR}/serve.log" ]] && cat "${WORKDIR}/serve.log" >&2; exit 1; }

[[ -x "${BIN}" ]] || fail "opencode binary not executable: ${BIN}"

echo "Starting opencode serve on :${PORT} (cwd=${WORKDIR}) ..."
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

# 1. Create a session.
CREATE="$(curl -fsS -X POST "${BASE}/session?directory=${WORKDIR}" \
  -H 'Content-Type: application/json' -d '{"title":"mcp-scope-regression-guard"}')" \
  || fail "session create request failed"
SID="$(printf '%s' "${CREATE}" | sed -n 's/.*"id":"\(ses_[^"]*\)".*/\1/p')"
[[ -n "${SID}" ]] || fail "could not parse session id from create response: ${CREATE}"
echo "Created session ${SID}"

# 2. PATCH a per-session allowlist (the path #765 broke).
CODE="$(curl -fsS -o /dev/null -w '%{http_code}' -X PATCH "${BASE}/session/${SID}?directory=${WORKDIR}" \
  -H 'Content-Type: application/json' -d '{"mcpAllowlist":{"servers":["rhythm"],"tools":[]}}')" \
  || fail "PATCH request failed"
[[ "${CODE}" == "200" ]] || fail "PATCH /session/${SID} returned HTTP ${CODE}"

# 3. Read it back — must reflect the allowlist. (Broken binary returns null here.)
GET="$(curl -fsS "${BASE}/session/${SID}?directory=${WORKDIR}")" || fail "GET request failed"
printf '%s' "${GET}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
al = d.get("mcpAllowlist")
if not al or al.get("servers") != ["rhythm"]:
    print("::error::mcpAllowlist did NOT persist through PATCH (issue #765 regression). Got:", json.dumps(al))
    sys.exit(1)
' || fail "per-session MCP allowlist did not persist (issue #765 regression)"

echo "OK: per-session MCP allowlist persisted through PATCH/GET (issue #765 guard passed)."
