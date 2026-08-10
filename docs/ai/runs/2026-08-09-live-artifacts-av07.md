---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-07]
status: PENDING_GRAPH_RECONCILIATION
tags: [run, live-artifacts, api_server, desktop_flutter]
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
c4dad5ed6db961dc1dd2ec71f1b20ce74b254aed79e54a72cca16264f17950f9  apps/desktop_flutter/build/macos/Build/Products/Release/Rhythm.app/Contents/MacOS/Rhythm
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
python3 -m json.tool docs/ai/contracts/live-artifacts-av07-docs-repair.json >/dev/null
python3 <local Markdown-fragment resolver>
git diff --check
```

Result: both JSON documents parsed, all AV07 Markdown-to-Markdown evidence
fragments resolved, and `git diff --check` passed. No product tests were run.

## Documentation/evidence repair

WAIVED: documentation/evidence-only repair; verification is: JSON parsing, local Markdown-fragment resolution, deployment-posture consistency, and Git divergence proof.

- After origin/main sync, the manager MCP re-run was **LOW / 0** with **105
  changed files**. The fresh CLI result was **HIGH / 15** across **105 files**.
  They conflict and are recorded as unresolved; no index was mutated.
- After `git fetch origin main`, `origin/main` is `8a3561d9` and the merge base
  is `617d9045`; the branch has the live-artifact change set while `origin/main`
  has the post-base navigation commit. This establishes divergence, but does not
  prove it explains the GitNexus discrepancy.
- The worktree lacks `.gitnexus/run.cjs`, so the local CLI result cannot be
  independently refreshed here without creating an index. Branch sync followed
  by a fresh GitNexus re-run is required before a PR.
  AC12's product evidence remains pass; PR readiness remains pending graph
  reconciliation.

## Notes

- AC1–AC12 are `pass` in `docs/ai/contracts/live-artifacts-av07.json`; no
  product criterion is waived or not tested. This does not clear the pending
  GitNexus reconciliation required for PR readiness.
- Deployment handoff now explicitly preserves both Postgres metadata and
  `/data/live-artifacts` immutable bytes across an additive rollout/rollback.
- Manual smoke is intentionally concise and points operators to the existing
  screenshots rather than duplicating automated assertions.
