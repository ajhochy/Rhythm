#!/usr/bin/env bash
#
# Launch the notarized app from its DMG with a brand-new HOME and a temp memory
# vault. This proves the packaged application—not a dev build—starts its
# bundled local server, leaves the user's global ~/.engraph untouched when
# Engraph is absent, and still provides the SQLite FTS memory fallback.
set -euo pipefail

DMG_PATH="${1:?usage: smoke_signed_clean_user.sh <notarized.dmg>}"
[[ -f "${DMG_PATH}" ]] || {
  echo "::error::Notarized DMG not found: ${DMG_PATH}" >&2
  exit 1
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rhythm-signed-smoke.XXXXXX")"
MOUNT_DIR="${WORKDIR}/mounted"
INSTALL_ROOT="${WORKDIR}/Applications"
CLEAN_HOME="${WORKDIR}/home"
MEMORY_VAULT="${WORKDIR}/memory-vault"
APP_PID=""
MOUNTED=0

mkdir -p "${MOUNT_DIR}" "${INSTALL_ROOT}" "${CLEAN_HOME}" "${MEMORY_VAULT}"

fail() {
  echo "::error::$*" >&2
  [[ -f "${WORKDIR}/rhythm.log" ]] && tail -80 "${WORKDIR}/rhythm.log" >&2
  exit 1
}

cleanup() {
  if [[ -n "${APP_PID}" ]]; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      kill -0 "${APP_PID}" >/dev/null 2>&1 || break
      sleep 0.25
    done
    kill -9 "${APP_PID}" >/dev/null 2>&1 || true
  fi
  if [[ "${MOUNTED}" -eq 1 ]]; then
    hdiutil detach "${MOUNT_DIR}" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

# Never reuse or terminate a developer's existing local agent server.
if lsof -nP -iTCP:4001 -sTCP:LISTEN -t >/dev/null 2>&1; then
  fail "localhost:4001 is already occupied; refusing to reuse or kill it"
fi

codesign --verify --strict --verbose=2 "${DMG_PATH}"
spctl --assess --type open --context context:primary-signature --verbose=4 "${DMG_PATH}"
xcrun stapler validate "${DMG_PATH}"

hdiutil attach "${DMG_PATH}" \
  -mountpoint "${MOUNT_DIR}" \
  -readonly \
  -nobrowse \
  -quiet
MOUNTED=1

MOUNTED_APP="$(find "${MOUNT_DIR}" -maxdepth 1 -name '*.app' -print -quit)"
[[ -n "${MOUNTED_APP}" ]] || fail "DMG does not contain an app bundle"
APP_PATH="${INSTALL_ROOT}/$(basename "${MOUNTED_APP}")"
ditto "${MOUNTED_APP}" "${APP_PATH}"

codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
spctl --assess --type execute --verbose=4 "${APP_PATH}"
xcrun stapler validate "${APP_PATH}"

[[ ! -e "${CLEAN_HOME}/.engraph" ]] ||
  fail "fresh HOME unexpectedly contains .engraph before launch"

APP_BINARY="${APP_PATH}/Contents/MacOS/Rhythm"
[[ -x "${APP_BINARY}" ]] || fail "packaged Rhythm executable is missing"

HOME="${CLEAN_HOME}" \
PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
MEMORY_VAULT_PATH="${MEMORY_VAULT}" \
MEMORY_VAULT_SUBDIR="AGENT-MEMORY" \
NSUnbufferedIO=YES \
"${APP_BINARY}" >"${WORKDIR}/rhythm.log" 2>&1 &
APP_PID=$!

HEALTH_OK=0
for _ in $(seq 1 240); do
  kill -0 "${APP_PID}" >/dev/null 2>&1 ||
    fail "signed app exited before its bundled server became healthy"
  if curl -fsS "http://127.0.0.1:4001/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 0.25
done
[[ "${HEALTH_OK}" -eq 1 ]] ||
  fail "timed out waiting for the signed app's bundled server"

STATUS_JSON="$(curl -fsS "http://127.0.0.1:4001/engraph-manager/status")" ||
  fail "GET /engraph-manager/status failed"
printf '%s' "${STATUS_JSON}" | node -e '
  let body = "";
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const value = JSON.parse(body);
    if (value.enabled !== false || value.state !== "disabled") process.exit(1);
  });
' || fail "Engraph manager was not disabled in the clean HOME"

DISCOVER_JSON="$(curl -fsS "http://127.0.0.1:4001/engraph-manager/discover")" ||
  fail "GET /engraph-manager/discover failed"
printf '%s' "${DISCOVER_JSON}" | node -e '
  let body = "";
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const value = JSON.parse(body);
    if (!Array.isArray(value.candidates) || value.candidates.length !== 0) process.exit(1);
  });
' || fail "Engraph must be absent for the clean-user fallback smoke"

MARKER="rhythm-clean-user-fts-${GITHUB_RUN_ID:-local}-${RANDOM}-$$"
CREATE_JSON="$(curl -fsS -X POST "http://127.0.0.1:4001/agent-memory" \
  -H 'Content-Type: application/json' \
  --data "{\"kind\":\"fact\",\"content\":\"Clean-user fallback marker ${MARKER}.\"}")" ||
  fail "POST /agent-memory failed"
printf '%s' "${CREATE_JSON}" | node -e '
  let body = "";
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const value = JSON.parse(body);
    if (typeof value.id !== "string" || typeof value.path !== "string") process.exit(1);
  });
' || fail "memory write did not return an id and vault path"

SEARCH_JSON="$(curl -fsS \
  "http://127.0.0.1:4001/agent-memory/search?q=${MARKER}")" ||
  fail "GET /agent-memory/search failed"
printf '%s' "${SEARCH_JSON}" | node -e '
  let body = "";
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const marker = process.argv[1];
    const rows = JSON.parse(body);
    const found = Array.isArray(rows) && rows.some(
      (row) => row && typeof row.content === "string" && row.content.includes(marker),
    );
    if (!found) process.exit(1);
  });
' "${MARKER}" || fail "SQLite FTS did not recall the clean-user memory"

[[ -z "$(find "${CLEAN_HOME}" -name .engraph -print -quit)" ]] ||
  fail "signed app touched .engraph in the clean HOME"

echo "Signed clean-user smoke passed: notarized app launched, Engraph stayed absent, and FTS recall worked."
