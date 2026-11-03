#!/usr/bin/env bash
# Pure preflight matrix for the opt-in loopback Cloud authentication fixture.
# Sources sandbox.sh without starting API, engine, or a listener.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX_SH="$ROOT/tools/dev/sandbox.sh"
passed=0
failed=0

check_case() {
  local description="$1" expected_status="$2" expected_text="$3"
  shift 3
  local output status
  output="$(env -i PATH="$PATH" HOME="$HOME" "$@" bash -c '
    source "$1"
    configure_auth_fixture
    for entry in "${runtime_env[@]}"; do
      case "$entry" in RHYTHM_CLOUD_API_URL=*) printf "%s\n" "$entry" ;; esac
    done
  ' bash "$SANDBOX_SH" 2>&1)"
  status=$?
  if [[ "$expected_status" == ok && "$status" -eq 0 && "$output" == "$expected_text" ]] ||
     [[ "$expected_status" == fail && "$status" -ne 0 && "$output" == *"$expected_text"* ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf 'FAIL %s: exit %s, output %q\n' "$description" "$status" "$output" >&2
  fi
}

check_case 'default has no Cloud override' ok ''
check_case 'owned loopback fixture accepted' ok 'RHYTHM_CLOUD_API_URL=http://127.0.0.1:7392' \
  RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_AUTH_FIXTURE_URL=http://127.0.0.1:7392
check_case 'bridge fixture required' fail 'requires RHYTHM_SANDBOX_BRIDGE_FIXTURE=1' \
  RHYTHM_SANDBOX_AUTH_FIXTURE_URL=http://127.0.0.1:7392
for origin in \
  'https://127.0.0.1:7392' 'http://localhost:7392' 'http://127.0.0.2:7392' \
  'http://name@127.0.0.1:7392' 'http://127.0.0.1:7392/' \
  'http://127.0.0.1:7392/auth/me' 'http://127.0.0.1:7392?x=1' \
  'http://127.0.0.1:7392#fragment' 'http://127.0.0.1:07392' \
  'http://127.0.0.1:80'; do
  check_case "reject noncanonical origin $origin" fail 'canonical loopback HTTP origin' \
    RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 "RHYTHM_SANDBOX_AUTH_FIXTURE_URL=$origin"
done
for port in 4001 4002 4096; do
  check_case "reject live port $port" fail 'reserved live port' \
    RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 "RHYTHM_SANDBOX_AUTH_FIXTURE_URL=http://127.0.0.1:$port"
done
for port in 4098 4097 4099; do
  check_case "reject sandbox port $port" fail 'must differ from sandbox runtime ports' \
    RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 "RHYTHM_SANDBOX_AUTH_FIXTURE_URL=http://127.0.0.1:$port"
done
check_case 'reject enabled relay port' fail 'must differ from sandbox runtime ports' \
  RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_RELAY=1 \
  RHYTHM_SANDBOX_AUTH_FIXTURE_URL=http://127.0.0.1:4100

printf 'sandbox auth fixture preflight: %s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
