#!/usr/bin/env bash
# T1 mobile<->desktop data-parity gate (MSP-007, issue #1273).
#
# Boots a disposable sandbox (API + engine + mobile gateway on private ports,
# throwaway copy of the local DB), pairs a throwaway mobile device against it,
# then runs the MSP-006 live parity test: every Tools payload served to the
# mobile gateway must match the desktop local API byte-for-byte after
# normalization. No browser, no simulator; runs in seconds.
#
# The harness plays the desktop's role in pairing: it holds a one-run
# capability secret whose hash is injected via HUMAN_APPROVAL_CAPABILITY_SHA256,
# and a one-run bearer that a local fake-cloud stand-in maps to the first real
# Google-linked user in the DB copy. Shipped auth code paths are exercised
# unmodified; nothing here weakens them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX="$ROOT/tools/dev/sandbox.sh"
PARITY_TEST="$ROOT/apps/mobile/tests/msp-006-live-parity.test.mjs"
EVIDENCE="${RHYTHM_PARITY_EVIDENCE_DIR:-$ROOT/.agent-stack/evidence/t1-parity-gate}"

export RHYTHM_SANDBOX_DIR="${RHYTHM_SANDBOX_DIR:-/private/tmp/rhythm-parity-gate}"
API_PORT="${RHYTHM_SANDBOX_API_PORT:-4098}"
ENGINE_PORT="${RHYTHM_SANDBOX_ENGINE_PORT:-4097}"
GATEWAY_PORT="${RHYTHM_SANDBOX_GATEWAY_PORT:-4099}"
FAKE_CLOUD_PORT="${RHYTHM_PARITY_FAKE_CLOUD_PORT:-4599}"

fail() { printf 'parity-gate: %s\n' "$*" >&2; exit 1; }
json_field() { node -e 'const v=JSON.parse(process.argv[1])[process.argv[2]];if(v===undefined)process.exit(1);process.stdout.write(String(v))' "$1" "$2"; }

[[ -f "$PARITY_TEST" ]] || fail "parity test not found: $PARITY_TEST"
for bin in openssl sqlite3 node curl; do
  command -v "$bin" >/dev/null || fail "$bin is required"
done
mkdir -p "$EVIDENCE"

# --- 1. One-run credentials (live only in this process + the throwaway DB copy)
CAP_SECRET="$(openssl rand -hex 32)"
CAP_SHA="$(printf '%s' "$CAP_SECRET" | openssl dgst -sha256 | awk '{print $NF}')"
BEARER="$(openssl rand -hex 32)"
# Standard P-256 generator point. Config validation demands a real curve point;
# the gate never verifies approval signatures, so the well-known point is safe.
export HUMAN_APPROVAL_CAPABILITY_SHA256="$CAP_SHA"
export HUMAN_APPROVAL_PUBLIC_KEY='BGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfU='
export RHYTHM_CLOUD_API_URL="http://127.0.0.1:$FAKE_CLOUD_PORT"

FAKE_CLOUD_PID=''
cleanup() {
  [[ -z "$FAKE_CLOUD_PID" ]] || kill "$FAKE_CLOUD_PID" 2>/dev/null || true
  "$SANDBOX" down >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 2. Fresh sandbox on private ports (its own guards refuse live desktop ports)
"$SANDBOX" down >/dev/null 2>&1 || true
"$SANDBOX" up

DB="$RHYTHM_SANDBOX_DIR/rhythm.db"
[[ -f "$DB" ]] || fail "sandbox DB copy missing: $DB"

# --- 3. Fake cloud answers /auth/me for our bearer as a real local user
IDENTITY="$(sqlite3 -separator $'\t' "$DB" \
  "SELECT id, name, email, google_sub FROM users
   WHERE google_sub IS NOT NULL AND google_sub != '' ORDER BY id LIMIT 1")"
[[ -n "$IDENTITY" ]] || fail 'no Google-linked user in the sandbox DB copy'
IFS=$'\t' read -r USER_ID USER_NAME USER_EMAIL USER_SUB <<<"$IDENTITY"

FAKE_CLOUD_PORT="$FAKE_CLOUD_PORT" FAKE_CLOUD_TOKEN="$BEARER" \
FAKE_CLOUD_USER_ID="$USER_ID" FAKE_CLOUD_NAME="$USER_NAME" \
FAKE_CLOUD_EMAIL="$USER_EMAIL" FAKE_CLOUD_GOOGLE_SUB="$USER_SUB" \
  node "$ROOT/tools/dev/parity/fake-cloud.mjs" >"$EVIDENCE/fake-cloud.log" 2>&1 &
FAKE_CLOUD_PID=$!
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$FAKE_CLOUD_PORT/__hits" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$FAKE_CLOUD_PORT/__hits" >/dev/null || fail 'fake cloud did not start'

# --- 4. Pair a throwaway device. The code is minted desktop-side (main API
# listener); the phone-facing hardened listener only accepts /pair onward.
GATEWAY="http://127.0.0.1:$GATEWAY_PORT"
DESKTOP="http://127.0.0.1:$API_PORT"
PAIRING_JSON="$(curl -fsS -X POST "$DESKTOP/mobile-gateway/pairing-codes" \
  -H "Authorization: Bearer $BEARER" \
  -H "X-Rhythm-Human-Approval: $CAP_SECRET" \
  -H 'Content-Type: application/json' -d '{}')" \
  || fail 'pairing-code mint failed (see sandbox log)'
PAIRING_CODE="$(json_field "$PAIRING_JSON" pairingCode)"
HOST_ID="$(json_field "$PAIRING_JSON" hostId)"

PAIR_BODY="$(node -e 'process.stdout.write(JSON.stringify({
  pairingCode: process.argv[1], hostId: process.argv[2], deviceName: "parity-gate",
}))' "$PAIRING_CODE" "$HOST_ID")"
PAIR_JSON="$(curl -fsS -X POST "$GATEWAY/mobile-gateway/pair" \
  -H 'Content-Type: application/json' -d "$PAIR_BODY")" || fail 'pairing failed'
DEVICE_TOKEN="$(json_field "$PAIR_JSON" deviceToken)"

# --- 5. Project scope: first live project whose working directory still exists
PROJECT_ID=''
PROJECT_ROOT=''
while IFS=$'\t' read -r pid cwd; do
  [[ -d "$cwd" ]] && { PROJECT_ID="$pid"; PROJECT_ROOT="$cwd"; break; }
done < <(sqlite3 -separator $'\t' "$DB" \
  "SELECT id, cwd FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC")
[[ -n "$PROJECT_ID" ]] || fail 'no usable project row in the sandbox DB copy'

# --- 6. Run the parity oracle
set +e
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_MOBILE_GATEWAY_URL="$GATEWAY" \
RHYTHM_LIVE_DESKTOP_API_URL="http://127.0.0.1:$API_PORT" \
RHYTHM_LIVE_DESKTOP_ENGINE_URL="http://127.0.0.1:$ENGINE_PORT" \
RHYTHM_LIVE_MOBILE_DEVICE_TOKEN="$DEVICE_TOKEN" \
RHYTHM_LIVE_PROJECT_ID="$PROJECT_ID" \
RHYTHM_LIVE_PROJECT_ROOT="$PROJECT_ROOT" \
  node --test "$PARITY_TEST" 2>&1 | tee "$EVIDENCE/run.log"
RC=${PIPESTATUS[0]}
set -e

node -e 'process.stdout.write(JSON.stringify({
  result: process.argv[1] === "0" ? "PASS" : "FAIL",
  gitSha: process.argv[2], projectId: process.argv[3], userEmail: process.argv[4],
  gatewayPort: process.argv[5], apiPort: process.argv[6],
}, null, 2) + "\n")' \
  "$RC" "$(git -C "$ROOT" rev-parse HEAD)" "$PROJECT_ID" "$USER_EMAIL" \
  "$GATEWAY_PORT" "$API_PORT" >"$EVIDENCE/summary.json"

cat "$EVIDENCE/summary.json"
exit "$RC"
