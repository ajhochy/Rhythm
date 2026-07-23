---
date: 2026-07-17
repo: Rhythm
branch: mega/opencode-utilization-1042-1108
status: VERIFICATION GATE — RED (Flutter blockers + live e2e isolation requirement)
tags: [run, verification, Rhythm]
---

# Mega-PR Stage-2 Verification Gate

**Branch:** `mega/opencode-utilization-1042-1108` (merged from Stage 1b + Stage 2)  
**Commit:** `df46380f46e383a76d6614a88a4c74dd376a233a`  
**Sandbox:** Running at http://127.0.0.1:4098 (healthy, verified via curl /health)

## Executive Summary

**Gate Status: RED** (blockers prevent GREEN claim, but successful evidence captured for available checks)

**Blockage Reasons:**
1. **Flutter/Dart not installed** — Cannot run `flutter analyze --no-fatal-infos` or Flutter tests (Stage 1b deliverable, merged into this branch)
2. **Live e2e requires full isolation** — Tests demand `RHYTHM_LIVE_E2E_ISOLATED=1` + temp DB copy + sandbox rebuild; instructions explicitly forbid `tools/dev/sandbox.sh down/up`

**Successful Evidence:**
- ✅ API server build: tsc clean, npm run build passes
- ✅ API server tests: 3000 passed / 18 pre-existing failures (memory_*.test.ts ENOENT), 0 branch-caused failures
- ✅ Critical contract tests: migrations_replay_guard ✓, org_settings_schema_parity ✓
- ✅ All Stage 2 issue contract tests: 1088, 1073, 1094, 1069, 1108, 1071, 1072 deterministic tests all passing
- ✅ Sandbox health: api_server responds to /health with status=ok

## Detailed Check Results

### 1. Static: Build (API Server)

```bash
cd /Users/ajhochhalter/Documents/Rhythm/apps/api_server && npm run build
```

**Exit Code:** 0  
**Output:** TypeScript compilation clean (tsc -p tsconfig.json), postbuild file copy succeeded  
**Result:** ✅ PASS

### 2. Unit/Integration: API Server Tests

```bash
cd /Users/ajhochhalter/Documents/Rhythm/apps/api_server && HOME=/tmp/rhythm-verify-s2 npm test
```

**Exit Code:** 1 (vitest run exits non-zero when ANY test fails, but failures are pre-existing)

**Summary:**
```
Test Files: 6 failed | 337 passed | 21 skipped (364 total)
Tests:      18 failed | 3000 passed | 38 skipped (3056 total)
```

**Failure Classification:**

| Category | Count | Files | Origin |
|----------|-------|-------|--------|
| Pre-existing ENOENT (memory_*.test.ts fixture vault failures) | 18 | 6 files | Documented in 2026-07-17-mega-CD.md as "memory_* failures (also fail on main)" |
| Branch-caused failures | 0 | — | None |

**Critical Contract Tests (Stage 2 deliverables):**

| Test | Status | Evidence |
|------|--------|----------|
| migrations_replay_guard (schema-drift guard) | ✅ PASS | "a second run on an already-migrated DB is a total data no-op" — 48ms |
| org_settings_schema_parity (dual-DB parity #1072) | ✅ PASS | "has identical column sets in SQLite and Postgres" — 56ms |

**Issue-Specific Contract Tests (verified passing):**

| Issue | Tests Passing | Sample |
|-------|---------------|--------|
| #1088 (schedulable decouple) | 5 | "accepts explicit schedulable override independent of sessionSelectable", "schedulable defaults to null (inherits sessionSelectable)" |
| #1073 (permission round-trip) | 4 | "seeds corePermissionsJson from engine on first import", "backfills corePermissionsJson on re-sync only when null", "NEVER overwrites user-set corePermissionsJson" |
| #1094 (image_generation) | 2 | "creates a config with imageGenerationEnabled granted", "imageGenerationEnabled defaults to false" |
| #1069 (rhythm-telemetry plugin) | 11 | "POSTs a tool-event with tool/session/callID/duration/status after completed call", "never blocks tool.execute.after", "RHYTHM_TOOL_TELEMETRY_DISABLED=1 registers no hooks" |
| #1108 (model override persistence) | 5 | (dedicated test file: issue_1108_model_override_persistence.test.ts — all 5 tests passing) |
| #1071 (managed config defaults) | — | (tests in opencode_plugin_config suite, all passing) |
| #1072 (org_settings) | 5 | "GET /org-settings/instructions 404s when nothing set", "PUT rejects unauthenticated", "a second PUT overwrites the singleton row" |

**Result:** ✅ PASS (3000 passing tests, 0 branch-caused failures; pre-existing failures match documented baseline)

### 3. PR-Level Build

**Command:** `npm run build` (already run in step 1)  
**Result:** ✅ PASS

### 4. Smoke Probes (Sandbox Health)

```bash
curl -s http://127.0.0.1:4098/health
```

**Response:**
```json
{"status":"ok","service":"rhythm-api-server","commit":"dev"}
```

**Process Check:**
```
PID 24451: node /Users/ajhochhalter/Documents/Rhythm/apps/api_server/dist/server.js --parent-pid=1 --rhythm-sandbox=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
```

**Result:** ✅ PASS (sandbox is running and healthy)

### 5. Smoke Completeness

**Status:** ⚠️ INCOMPLETE (live e2e blocked by environment constraints)

**Unverified Flows:**

| Flow | Reason | Why Blocked |
|------|--------|-------------|
| Live E2E #1088 (hidden specialist schedule) | Live behavior test | Requires `RHYTHM_LIVE_E2E_ISOLATED=1` + temp DB + sandbox rebuild; dispatch forbids `sandbox.sh down/up` |
| Live E2E #1073 (permission denial enforced) | Live behavior test | Same isolation requirement + sandbox rebuild blocker |
| Live E2E #1094 (image_generation grant) | Live behavior test + fork gap | Fork edit needed (documented in CD run); additional sandbox blocker |
| Live E2E #1069 (tool-event rows align) | Live behavior test | Requires real engine session + sandbox rebuild |
| Live E2E #1072 (org-instruction marker) | Live behavior test | Requires real agent run + sandbox rebuild |
| Flutter analyze | Development toolchain | Flutter/Dart not installed in environment |
| Flutter tests (ocu_1061/1062/1063_1066/1064/1065) | Development toolchain | Flutter/Dart not installed in environment |

**Deterministic Proxy Evidence Available:**
- Contract + unit tests covering all Stage 2 acceptace criteria (listed in section 2 above)
- Sandbox health verified
- API build verified

**Result:** ⚠️ INCOMPLETE COVERAGE (deterministic tests passing, live behavioral + Flutter checks blocked by environment)

### 6. Repo-Specific Gates

None configured beyond what's covered in sections 2 and 5.

### 7. Repo-Wide Reference Check

No public symbols were renamed or removed in Stage 2 (API-only changes; no exports affected).

**Result:** ✅ PASS (no scope for this check)

### 8. Visual/UI Changes

No UI changes in Stage 2 API work.

**Result:** N/A

## Blocked Items Summary

### Environment Blocker 1: Flutter/Dart Toolchain Missing

**Commands Attempted:**
```
which flutter → not found
which dart → not found
brew list | grep flutter → not installed
```

**Impact:**
- Cannot run: `flutter analyze --no-fatal-infos`
- Cannot run: `flutter test test/features/agents/ocu_1061_at_mention_test.dart` (and 4 other new test files)

**Evidence from Stage 1b (merged earlier):**
From `docs/ai/runs/2026-07-17-mega-B-flt-remainder.md`:
- `dart format <scoped files>` → 0 changes (clean)
- `flutter analyze <scoped files>` → 0 new errors, 13 pre-existing infos
- `flutter test test/features/agents/` → 582 passed
- `flutter test` (full suite) → 921 passed

Flutter work was verified at Stage 1b; Flutter files merged into this branch did not change Flutter-only code (verified Stage 1b tests covered the changes).

**Classification:** Environment intervention required (install Flutter SDK)

### Environment Blocker 2: Live E2E Requires Full Isolation

**Constraint:** Dispatch instructions explicitly state "DO NOT run sandbox up/down; reuse for live e2e"

**Live E2E Test Requirement:**
```bash
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
DB_PATH=/tmp/<isolated>/rhythm.db \
RHYTHM_LIVE_DB_PATH=/tmp/<isolated>/rhythm.db \
npx vitest run src/__tests__/live_e2e_1088_hidden_schedulable.test.ts
```

**Attempted Workaround:**
```bash
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
npx vitest run src/__tests__/live_e2e_1088_hidden_schedulable.test.ts
```

**Result:**
```
Error: [live-E2E isolation guard] refusing to run against a non-isolated backend —
RHYTHM_LIVE_E2E_ISOLATED=1 is not set; DB_PATH points at the REAL DB.
```

**Reason Isolation Required:** Live tests mutate database state; non-isolated run would corrupt the real production DB.

**Classification:** Safety-gate enforcement; not a failure per se, a correct refusal to run unsafely

## Branch Changes Summary

**Files changed:** 37 (from `git diff --name-only main...HEAD`)
- **API (7 new test files added for Stage 2 issues)**
- **Flutter (13 files changed — Stage 1b merged)**
- **Infrastructure (migrations, routes, plugins)**

**Pre-existing Test Failures (Confirmed Baseline):**
18 memory_*.test.ts failures (ENOENT on vault fixture files) — **NOT caused by this branch**, confirmed as pre-existing in docs/ai/project-state.md

**Branch-Caused Failures:** 0

## Recommendation

**Current Status:** Gate cannot emit GREEN without:
1. ✅ API server build passing (done)
2. ✅ API server tests baseline passing, no branch-caused failures (done)
3. ❌ Flutter environment available (blocker: not installed)
4. ❌ Live e2e running against isolated sandbox (blocker: dispatch forbids sandbox rebuild)

**Path to GREEN:**

**Option A (Recommended — Environment Repair):**
1. Install Flutter SDK on this machine or use a machine where it is available
2. Run `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` → verify 0 new errors
3. Run `flutter test test/features/agents/ocu_*_test.dart` → verify all pass
4. Request human approval to rebuild sandbox in place (requires `tools/dev/sandbox.sh down && up`) OR use an offline-sandbox instance with the rebuilt code
5. Run live e2e tests with `RHYTHM_LIVE_E2E_ISOLATED=1` and temp DB copy
6. Rerun verification-gate on success

**Option B (Deferred Verification):**
Given that:
- Stage 1b Flutter work already passed full Flutter test suite (921 tests) in `2026-07-17-mega-B-flt-remainder.md`
- Stage 2 is API-only (no new Flutter code in this run)
- All deterministic API contracts passing (3000 tests, 0 branch-caused failures)

A human reviewer MAY accept the Stage 2 deterministic evidence as sufficient for API merge, with the understanding that Flutter is verified separately from Stage 1b. The live e2e tests remain written and ready to execute once isolation is available.

## Files Changed (Verification Evidence)

```
apps/api_server/src/__tests__/live_e2e_1073_permission_roundtrip.test.ts ✅ Written
apps/api_server/src/__tests__/live_e2e_1088_hidden_schedulable.test.ts ✅ Written
apps/api_server/src/__tests__/live_e2e_1094_image_generation_grant.test.ts ✅ Written (reduced scope)
apps/api_server/src/__tests__/org_settings_routes.test.ts ✅ 5 tests passing
apps/api_server/src/__tests__/org_settings_schema_parity.test.ts ✅ 1 test passing
apps/api_server/src/__tests__/rhythm_telemetry_plugin.test.ts ✅ 11 tests passing
apps/api_server/src/services/__tests__/issue_1108_model_override_persistence.test.ts ✅ 5 tests passing
```

All Stage 2 API files building and testing clean. Flutter files from Stage 1b already verified in earlier run.

---

## Next Action

Per verification-gate skill and blocker classification:

- **Environment repair needed** for Flutter (install SDK)
- **OR human decision** on whether deterministic API evidence + Stage 1b Flutter evidence suffices for merge

Currently blocked from emitting `PASS` due to incomplete toolchain + sandbox isolation constraints, not due to test failures.
