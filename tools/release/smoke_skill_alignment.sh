#!/usr/bin/env bash
#
# Regression guard for the skill-unification work (docs/ai/decisions/
# 2026-06-28-unify-skills-source-of-truth.md). The invariants are silent when
# violated, so every path is verified against the ACTUAL built fork binary:
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
# #798 extends the guard through the api_server's compiled apply/measure code:
# managed keep, byte-identical managed revert, and external fork-to-shadow/revert.
#
# Usage: smoke_skill_alignment.sh <opencode-binary> [port]
set -euo pipefail

BIN="${1:?usage: smoke_skill_alignment.sh <opencode-binary> [port]}"
PORT="${2:-4399}"
BASE="http://127.0.0.1:${PORT}"
WORKDIR="$(mktemp -d)"
HOME_DIR="${WORKDIR}/home"
MANAGED_DIR="${HOME_DIR}/.config/opencode/rhythm-managed-skills"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_DIST="${REPO_ROOT}/apps/api_server/dist"
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

[[ -f "${API_DIST}/services/skill_apply.js" ]] \
  || fail "compiled api_server missing at ${API_DIST}; run 'npm run build' in apps/api_server first"

# Exercise the real compiled api_server apply→measure implementation while its
# list/reload boundary talks to the built fork process above. The scorer is
# deterministic; filesystem writes, SQLite ledger transitions, engine reload,
# and live GET /skill discovery are real.
RHYTHM_MANAGED_SKILLS_DIR="${MANAGED_DIR}" \
RHYTHM_SMOKE_BASE="${BASE}" \
RHYTHM_SMOKE_WORKDIR="${WORKDIR}" \
RHYTHM_API_DIST="${API_DIST}" \
RHYTHM_API_ROOT="${REPO_ROOT}/apps/api_server" \
DB_CLIENT=sqlite \
NODE_ENV=development \
VITEST= \
node <<'NODE'
const assert = require('node:assert/strict');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');

const dist = process.env.RHYTHM_API_DIST;
const apiRoot = process.env.RHYTHM_API_ROOT;
const base = process.env.RHYTHM_SMOKE_BASE;
const workdir = process.env.RHYTHM_SMOKE_WORKDIR;
const managedRoot = process.env.RHYTHM_MANAGED_SKILLS_DIR;
const Database = require(require.resolve('better-sqlite3', { paths: [apiRoot] }));
const { runMigrations } = require(`${dist}/database/migrations.js`);
const { setDb } = require(`${dist}/database/db.js`);
const {
  AgentSkillsRepository,
} = require(`${dist}/repositories/agent_skills_repository.js`);
const {
  applyAndMeasure,
} = require(`${dist}/services/skill_apply.js`);
const {
  measureAppliedSkill,
} = require(`${dist}/services/skill_measurement.js`);
const {
  writeManagedSkill,
  slugForSkillName,
} = require(`${dist}/services/rhythm_managed_skills.js`);

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrations(db);
setDb(db);
const repo = new AgentSkillsRepository(db);

const skillUrl = () => `${base}/skill?directory=${encodeURIComponent(workdir)}`;
const listSkills = async () => {
  const response = await fetch(skillUrl());
  assert.equal(response.status, 200, `GET /skill failed: ${response.status}`);
  return response.json();
};
const reloadSkills = async () => {
  const response = await fetch(
    `${base}/skill/reload?directory=${encodeURIComponent(workdir)}`,
    { method: 'POST' },
  );
  assert.equal(response.status, 200, `POST /skill/reload failed: ${response.status}`);
  return listSkills();
};
const scoreByMarker = (winner) => async (_purpose, body) => ({
  score: (body ?? '').includes(winner) ? 90 : 20,
  reason: `deterministic smoke marker: ${winner}`,
});
const liveNames = async () => (await listSkills()).map((skill) => skill.name);
const countName = (names, name) => names.filter((candidate) => candidate === name).length;

(async () => {
  // issue-798-c1 — managed auto-apply → keep.
  const keepName = 'guard-managed-keep';
  const keepLocation = writeManagedSkill({
    name: keepName,
    description: 'Managed keep baseline',
    body: '# Baseline managed keep\n',
  });
  const keepBefore = readFileSync(keepLocation);
  await reloadSkills();
  const keepOutcome = await applyAndMeasure(
    {
      name: keepName,
      description: 'Managed keep winner',
      body: '# Revised managed keep WINNER\n',
      confidence: 0.9,
      source: 'auto-refined',
    },
    {
      repo,
      listSkills,
      reloadSkills,
      measure: (skill) =>
        measureAppliedSkill(skill, {
          repo,
          scorer: scoreByMarker('WINNER'),
          reload: reloadSkills,
        }),
    },
  );
  assert.equal(keepOutcome, 'applied-managed');
  const kept = repo.findByName(keepName);
  assert.equal(kept.status, 'active');
  assert.ok(kept.postScore > kept.baselineScore);
  assert.notDeepEqual(readFileSync(keepLocation), keepBefore);
  assert.equal(countName(await liveNames(), keepName), 1);
  console.log('issue-798-c1: managed apply→keep + persisted scores + live reload: OK');

  // issue-798-c2 — managed auto-revert restores the exact prior bytes.
  const revertName = 'guard-managed-revert';
  const revertDir = join(managedRoot, slugForSkillName(revertName));
  const revertLocation = join(revertDir, 'SKILL.md');
  mkdirSync(revertDir, { recursive: true });
  const revertBefore = Buffer.from(
    '---\nname: guard-managed-revert\ndescription: "Exact: original formatting"\n---\n\n# ORIGINAL WINNER\n\nTrailing spaces stay.  \n',
  );
  writeFileSync(revertLocation, revertBefore);
  await reloadSkills();
  const revertOutcome = await applyAndMeasure(
    {
      name: revertName,
      description: 'Losing revision',
      body: '# Losing revision\n',
      confidence: 0.9,
      source: 'auto-refined',
    },
    {
      repo,
      listSkills,
      reloadSkills,
      measure: (skill) =>
        measureAppliedSkill(skill, {
          repo,
          scorer: scoreByMarker('ORIGINAL WINNER'),
          reload: reloadSkills,
        }),
    },
  );
  assert.equal(revertOutcome, 'applied-managed');
  assert.equal(repo.findByName(revertName).status, 'reverted');
  assert.deepEqual(readFileSync(revertLocation), revertBefore);
  assert.equal(countName(await liveNames(), revertName), 1);
  console.log('issue-798-c2: managed apply→revert restored byte-identical prior: OK');

  // issue-798-c3/c4 — external original never changes; the same-name managed
  // shadow is live during measurement without adding a duplicate name, then is
  // removed and the external original becomes live again.
  const externalName = 'guard-external-shadow';
  const externalDir = join(process.env.HOME, '.claude', 'skills', externalName);
  const externalLocation = join(externalDir, 'SKILL.md');
  mkdirSync(externalDir, { recursive: true });
  const externalBefore = Buffer.from(
    '---\nname: guard-external-shadow\ndescription: External original\n---\n\n# EXTERNAL WINNER\n',
  );
  writeFileSync(externalLocation, externalBefore);
  await reloadSkills();
  const shadowDir = join(managedRoot, slugForSkillName(externalName));
  const externalOutcome = await applyAndMeasure(
    {
      name: externalName,
      description: 'Losing managed shadow',
      body: '# Losing managed shadow\n',
      confidence: 0.9,
      source: 'auto-refined',
    },
    {
      repo,
      listSkills,
      reloadSkills,
      measure: async (skill) => {
        assert.deepEqual(readFileSync(externalLocation), externalBefore);
        assert.ok(existsSync(join(shadowDir, 'SKILL.md')), 'managed shadow missing during measure');
        assert.equal(countName(await liveNames(), externalName), 1);
        return measureAppliedSkill(skill, {
          repo,
          scorer: scoreByMarker('EXTERNAL WINNER'),
          reload: reloadSkills,
        });
      },
    },
  );
  assert.equal(externalOutcome, 'applied-external-fork');
  assert.equal(repo.findByName(externalName).status, 'reverted');
  assert.equal(existsSync(shadowDir), false);
  assert.deepEqual(readFileSync(externalLocation), externalBefore);
  const finalExternal = (await listSkills()).filter((skill) => skill.name === externalName);
  assert.equal(finalExternal.length, 1);
  assert.equal(finalExternal[0].location, externalLocation);
  console.log('issue-798-c3/c4: external unchanged + shadow removed + one live name: OK');

  db.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

echo "OK: no-skill-lost + names-alignment + apply/keep/revert/external guards passed."
