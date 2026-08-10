---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: []
status: PASS
tags: [run, live-artifacts, api_server, desktop_flutter]
index: "[[Rhythm]]"
---

# AV-07 — integrated evidence and handoff

## Files

- Strengthened the real engine/MCP live test for the AC8 agent-to-human same-ID path.
- Added the AC1–AC12 reconciliation contract and minimal operator/deployment handoff.
- No product runtime, schema, route, MCP, Flutter, or engine behavior changed.
- This documentation/evidence repair changed no product file; the existing dirty
  live-test file predates this repair.

## Acceptance contract

The contract was made executable before the final test-harness change:

```text
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-dev-sandbox" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_SANDBOX_DB="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts --no-file-parallelism
```

Initial result: **1 failed** — the new collaborator GET correctly returned `404`
while the fixture still created a private artifact (`expected 404 to be 200`).
The test then drove the real MCP create payload with `visibility: shared` and the
seeded current-workspace collaborator, and supplied all four editable calendar
fields to the real MCP state update. This catches a regression that drops title,
theme, or service data while changing scripture.

## Checks

### V3 — real ephemeral Postgres bootstrap twice

```text
docker run -d --rm --name av07-pg-<pid> -e POSTGRES_PASSWORD=av07 -e POSTGRES_USER=av07 -e POSTGRES_DB=av07 -p 55434:5432 postgres:16
RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1 RHYTHM_LIVE_POSTGRES_URL=postgres://av07:av07@127.0.0.1:55434/av07 npx vitest run src/__tests__/postgres_bootstrap_live.test.ts src/__tests__/live_artifacts_schema_parity.test.ts
```

Result: **2 files / 2 tests passed** (484 ms). The disposable Postgres 16
container was removed. This independently re-ran the bootstrap-twice contract;
the earlier full catalog/backfill evidence is retained in
`2026-08-08-live-artifacts-av01.md#repair-pass-2`.

### V4 — real fork engine → MCP → hosted API → human collaborator

Source SHA: `afa2f0d1`. Fork build: `bun run build --single` produced
`0.0.0-feat/artifact-viewer-202608100154`; API `npm run build` passed. Sandbox
was started only through `tools/dev/sandbox.sh`, at API `:4098`, engine `:4097`,
with storage under `$TMPDIR/rhythm-dev-sandbox/live-artifacts`.

```text
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-dev-sandbox" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_SANDBOX_DB="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts --no-file-parallelism
```

Result: **1 file / 1 test passed** (13.24 s). A fixture provider drove the real
engine session, which advertised all five AV03 tools and invoked create → state
CAS update → get. It created a shared Worship Calendar, updated title, scripture,
theme, and service details at state revision 1 → 2, then a distinct seeded
human collaborator/session performed an authenticated hosted `GET` under the
same UUID. The test asserts one artifact row plus the artifact and revision-2
actor fields. Its `finally` removes collaborator records, revisions, artifacts,
sessions, memberships, workspace, and the collaborator user. `sandbox.sh down`
removed the isolated sandbox after V4.

### V5/V6

Flutter commands used the real HOME and explicit local Flutter SDK path:

```text
PATH=/Users/ajhochhalter/development/flutter/bin:$PATH dart format . --set-exit-if-changed
PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter analyze --no-fatal-infos
PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts
PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test
```

Result: format clean, analyze clean, focused live-artifact tests passed, full
Flutter suite **1097 passed**. No product behavior changed after AV06, so the
fresh native/package evidence is referenced rather than rerun. Its retained
artifacts were verified present and SHA-256 matched:

```text
f0357d4d5c9434d3c7d4ea5a572d91c922dcddac12983a5c1130e96c9f04f61e  docs/ai/runs/evidence/av06-dashboard-artifact.png
82e8f338b003b83f3c5f0305d102aad7eb08d83458efa77454d4d5bd785a3d56  docs/ai/runs/evidence/av06-native-artifact.png
1c72a4489caf5231c2e66d95f8ed350ab26836f90287178a605f39359181953c  apps/desktop_flutter/build/macos/Build/Products/Release/Rhythm.app/Contents/MacOS/Rhythm
```

The Release binary exists and is executable. AV06's final native/security/a11y
evidence is recorded in `2026-08-09-live-artifacts-av06-final.md`.

### V7 — PR gate

`ai-workflow checks --level pr` first failed only because this agent shell
inherited `AGENT_LOCAL=true`, `DB_PATH` pointing at the desktop DB, `PORT=4001`,
and real memory-vault variables. The resulting two `memory_injection` failures
match the pre-existing environment-contamination classification in
`2026-08-08-live-artifacts-av01.md#repair-pass-2`; no AV07 file is involved.

```text
env -u AGENT_LOCAL -u MEMORY_VAULT_PATH -u MEMORY_VAULT_SUBDIR -u DB_PATH -u PORT PATH=/Users/ajhochhalter/development/flutter/bin:$PATH ai-workflow checks --level pr
```

Result: **passed** all listed PR checks: Flutter analyze/format/test, API and MCP
typechecks/builds/tests, serial API Vitest, fork typecheck/session tests, and
mobile static/contract/fake-server/web checks.

### V8 — documentation/evidence checks

```text
python3 -m json.tool docs/ai/contracts/live-artifacts-av07.json >/dev/null
python3 <local Markdown-fragment resolver>
git diff --check
```

Result: the authoritative AV07 contract parsed, all AV07 Markdown-to-Markdown
evidence fragments resolved, and `git diff --check` passed.

## Post-main-merge reconciliation

- Merged `origin/main` (`8a3561d9`) into the feature branch without conflicts.
- The post-merge production gate passed: sanitized PR checks, API **4127**,
  Flutter **1129**, live-artifact **48**, MCP **169**, focused MCP/security **21**,
  AV03 contract **11**, Postgres bootstrap/parity **2**, and native AV06 A1–A10/C3–C5.
- PR checks regenerated nine tracked `.proof` PNGs; they were restored to HEAD
  because they are unrelated test-harness output, not feature evidence.

GitNexus was re-run after the merge. Manager MCP reported LOW / zero processes;
the exact-worktree CLI conservatively reported **HIGH**, 95 source files, 651
symbols, and eight affected processes. The HIGH result is retained for PR review.
All eight flows reduce to two tested entry points:

- Five `ReadPcoServices` flows (`Iso`, Postgres, SQLite, refresh, `AppError`) are
  covered by AV05's 94 focused tests, controlled live PCO fixture, full API
  suite, and Postgres parity gate.
- Three `Create` flows (`AppError`, Postgres, SQLite workspace membership) are
  covered by AV02 authorization/storage tests, the real MCP create flow, and
  Postgres bootstrap/parity.

No affected GitNexus process lacks a corresponding focused and live check.
The guarded DEBUG-only `MainFlutterWindow` registration retains its explicit
startup-risk review and is absent from the Release binary.

## Notes

- Final verification gate passed at `050f8c28` after merging `origin/main`
  `8a3561d9`; the working tree was clean before this memory update.
- This was a user-requested feature with no GitHub issue. The draft PR must use
  the waived issue-link line and hand off `docs/testing/manual-smoke.md` to a
  human; no deploy or merge is authorized.
- AC1–AC12 are `pass` in `docs/ai/contracts/live-artifacts-av07.json`; no
  product criterion is waived or not tested.
- Deployment handoff now explicitly preserves both Postgres metadata and
  `/data/live-artifacts` immutable bytes across an additive rollout/rollback.
- Manual smoke is intentionally concise and points operators to the existing
  screenshots rather than duplicating automated assertions.
