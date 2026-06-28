#!/usr/bin/env bash
#
# Regression guard for the skill-unification work (docs/ai/decisions/
# 2026-06-28-unify-skills-source-of-truth.md). Two invariants, both silent when
# violated, both verified against the ACTUAL built fork binary:
#
#   1. NO SKILL LOST — registering the Rhythm-managed skills dir via
#      config.skills.paths is purely additive. Skills discovered before the
#      managed dir has content must STILL be discovered after a managed skill is
#      written + the cache reloaded. A config-writer bug that dropped the other
#      scan dirs would fail here.
#
#   2. NAMES ALIGNMENT (#775) — a name taken from the live GET /skill set
#      round-trips through a per-session skillAllowlist. This is the invariant
#      that makes scoping work: allowed_skills_json names MUST equal the fork's
#      SKILL.md `name`s or scoping silently matches nothing.
#
# It also exercises POST /skill/reload (the unify-1 re-scan trigger): a managed
# SKILL.md written AFTER the instance memoized discovery must appear after reload.
#
# Usage: smoke_skill_alignment.sh <opencode-binary> [port]
set -euo pipefail

BIN="${1:?usage: smoke_skill_alignment.sh <opencode-binary> [port]}"
PORT="${2:-4399}"
BASE="http://127.0.0.1:${PORT}"
WORKDIR="$(mktemp -d)"
HOME_DIR="${WORKDIR}/home"
MANAGED_DIR="${HOME_DIR}/.config/opencode/rhythm-managed-skills"
SERVE_PID=""

cleanup() {
  [[ -n "${SERVE_PID}" ]] && kill "${SERVE_PID}" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}" || true
}
trap cleanup EXIT

fail() { echo "::error::$*" >&2; [[ -f "${WORKDIR}/serve.log" ]] && cat "${WORKDIR}/serve.log" >&2; exit 1; }

[[ -x "${BIN}" ]] || fail "opencode binary not executable: ${BIN}"

# A baseline skill that exists BEFORE the managed dir has any content. After we
# write a managed skill + reload, this must still be present (no skill lost).
mkdir -p "${HOME_DIR}/.claude/skills/baseline-skill"
cat >"${HOME_DIR}/.claude/skills/baseline-skill/SKILL.md" <<'EOF'
---
name: baseline-skill
description: Baseline skill that must survive managed-dir registration.
---

# Baseline Skill
EOF

# opencode.json with the managed dir registered (as api_server writes it at boot,
# before spawn) — the dir starts empty.
mkdir -p "${HOME_DIR}/.config/opencode" "${MANAGED_DIR}"
cat >"${HOME_DIR}/.config/opencode/opencode.json" <<EOF
{ "\$schema": "https://opencode.ai/config.json", "skills": { "paths": ["${MANAGED_DIR}"] } }
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

# Baseline: list skills BEFORE writing into the managed dir.
BEFORE="$(curl -fsS "${BASE}/skill?directory=${WORKDIR}")" || fail "GET /skill (before) failed"
printf '%s' "${BEFORE}" | python3 -c '
import sys, json
names = {s["name"] for s in json.load(sys.stdin)}
assert "baseline-skill" in names, f"baseline-skill missing before reload: {sorted(names)}"
print("before:", sorted(names))
' || fail "baseline-skill not discovered before reload"

# Write a managed skill AFTER the instance has memoized discovery.
mkdir -p "${MANAGED_DIR}/rhythm-owned"
cat >"${MANAGED_DIR}/rhythm-owned/SKILL.md" <<'EOF'
---
name: rhythm-owned
description: A Rhythm-authored skill written into the managed dir.
---

# Rhythm Owned
EOF

# Reload (unify-1 trigger) and re-list.
curl -fsS -X POST "${BASE}/skill/reload?directory=${WORKDIR}" >/dev/null || fail "POST /skill/reload failed"
AFTER="$(curl -fsS "${BASE}/skill?directory=${WORKDIR}")" || fail "GET /skill (after) failed"

printf '%s' "${AFTER}" | python3 -c '
import sys, json
names = {s["name"] for s in json.load(sys.stdin)}
# No skill lost: the baseline is still there.
if "baseline-skill" not in names:
    print("::error::baseline-skill LOST after managed-dir registration + reload:", sorted(names)); sys.exit(1)
# Re-scan picked up the managed skill.
if "rhythm-owned" not in names:
    print("::error::managed skill not discovered after reload (unify-1/2 regression):", sorted(names)); sys.exit(1)
print("after:", sorted(names))
' || fail "no-skill-lost / managed-skill-discovered invariant failed"

# Names alignment (#775): a name from the LIVE set round-trips through a
# per-session skillAllowlist.
CREATE="$(curl -fsS -X POST "${BASE}/session?directory=${WORKDIR}" \
  -H 'Content-Type: application/json' -d '{"title":"skill-alignment-guard"}')" \
  || fail "session create failed"
SID="$(printf '%s' "${CREATE}" | sed -n 's/.*"id":"\(ses_[^"]*\)".*/\1/p')"
[[ -n "${SID}" ]] || fail "could not parse session id: ${CREATE}"

CODE="$(curl -fsS -o /dev/null -w '%{http_code}' -X PATCH "${BASE}/session/${SID}?directory=${WORKDIR}" \
  -H 'Content-Type: application/json' -d '{"skillAllowlist":{"skills":["rhythm-owned"]}}')" \
  || fail "PATCH skillAllowlist failed"
[[ "${CODE}" == "200" ]] || fail "PATCH returned HTTP ${CODE}"

GET="$(curl -fsS "${BASE}/session/${SID}?directory=${WORKDIR}")" || fail "GET session failed"
printf '%s' "${GET}" | python3 -c '
import sys, json
al = json.load(sys.stdin).get("skillAllowlist")
if not al or al.get("skills") != ["rhythm-owned"]:
    print("::error::live skill name did not round-trip through skillAllowlist:", json.dumps(al)); sys.exit(1)
' || fail "names-alignment invariant failed (#775)"

echo "OK: no-skill-lost + managed-skill-discovered + names-alignment guards passed."
