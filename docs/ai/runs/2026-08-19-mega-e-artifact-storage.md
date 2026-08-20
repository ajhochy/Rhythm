---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-e-artifact-storage
pr: null
issues: [1396, 1397, 1394]
status: blocked
tags: [run, Rhythm]
---

# Files

- Added boot-time read/write verification and current-content diagnostics in
  `apps/api_server/src/services/live_artifact_storage.ts`, wired before listen
  in `server.ts`.
- Partitioned new relay file writes under `relay-artifacts/`; reads prefer the
  partition and fall back to legacy root files.
- Required an explicit existing Synology API volume name, added pre/post
  checksum checks, incident diagnosis commands, and backup/recovery guidance.
- Added focused startup, diagnostic, Compose, and relay migration tests.
- Added `apps/api_server/src/__tests__/issue_1396_storage_startup_abort.test.ts`,
  which spawns the built server and proves two real filesystem permission
  failures abort before any listening banner.

# Checks

- Acceptance red: `npx vitest run src/services/__tests__/live_artifact_storage_safety.test.ts`
  — 4 tests failed before implementation (missing startup verifier, relay
  namespace resolver, content diagnostic, and stable Compose volume identity).
- `npm install` — pass; fresh worktree dependencies installed. npm reported 15
  existing audit findings (1 low, 7 moderate, 7 high); no dependency changed.
- `npx tsc --noEmit` — pass.
- `npx vitest run src/services/__tests__/live_artifact_storage_safety.test.ts src/__tests__/relay_artifacts_contract.test.ts`
  — pass, 14/14.
- `npx vitest run src/__tests__/live_artifact_content_storage.test.ts` — pass, 7/7.
- `sh -n scripts/check-live-artifact-storage.sh` — pass.
- `git diff --check` — pass.
- Live sandbox — not run by instruction; the orchestrator owns serial sandbox
  verification because ports 4098/4097 are singleton resources.
- `npm run build` — pass; generated `dist/server.js` before the process test.
- `npx tsc --noEmit` — pass (no output, exit 0).
- `npx vitest run src/__tests__/issue_1396_storage_startup_abort.test.ts --no-file-parallelism`
  — pass, 1/1. Both child processes exited `1`; neither output contained a
  `Rhythm API listening` or `Rhythm mobile gateway listening` banner.
- Evidence capture command:
  `npx vitest run src/__tests__/issue_1396_storage_startup_abort.test.ts --no-file-parallelism --disableConsoleIntercept --reporter=verbose`
  — pass, 1/1. Exact actionable lines observed:
  - `Error: LIVE_ARTIFACT_STORAGE_DIR is not readable and writable at resolved path "/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-1396-startup-hG303H/readonly-parent/missing" (EACCES)`; exit `1`.
  - `Error: LIVE_ARTIFACT_STORAGE_DIR is not readable and writable at resolved path "/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-1396-startup-hG303H/readonly-existing" (EACCES)`; exit `1`.
- `npx vitest run src/__tests__/relay_artifacts_contract.test.ts src/services/__tests__/live_artifact_storage_safety.test.ts src/__tests__/live_artifact_content_storage.test.ts --no-file-parallelism`
  — pass, 21/21 across 3 files.

# Notes

- #1396 chooses abort-startup. A server that cannot read and write its resolved
  artifact target must not advertise healthy; the thrown message names both
  `LIVE_ARTIFACT_STORAGE_DIR` and the resolved path.
- #1397 migration is additive: no existing relay files move or delete. New
  writes use `<root>/relay-artifacts`; reads try that location first and then
  the legacy flat root.
- #1394 host facts remain explicitly UNKNOWN in
  `docs/release/synology_live_artifact_storage_incident.md`. The operator must
  run the listed Synology commands to close them.
- No destructive database or filesystem operation was added. Switching
  production to a rescue volume or restoring Postgres remains manual-review
  work; recovery never extracts over the current volume.
- GitNexus had indexed file nodes but no symbols/relationships for the scoped
  TypeScript files, so pre-edit impact calls returned UNKNOWN rather than a
  usable risk graph.
- Confirmed `server.ts` startup ordering before spawning: storage import at
  lines 113–116, `await verifyLiveArtifactStorageDir()` at 118,
  `await initDb()` at 119, and `httpServer.listen(...)` at 796. No engine
  initialization, port reclamation, process signaling, or listener starts
  before the storage verifier.
- WAIVED: pre-implementation failing run is inapplicable because this dispatch adds evidence for already-implemented behavior and forbids product changes absent a defect; verification is the new built-server process contract passing both real permission failures.
- #1394-c4 was not expanded into this spawned-process test: proving both the
  operator startup diagnostic and client path non-disclosure would require a
  successfully booted listening server, explicitly outside this no-sandbox
  abort-only dispatch. Existing focused coverage remains unchanged.
- Live-port proof before and after the spawned-process checks was unchanged:
  `127.0.0.1:4001` remained Node PID `30369`, and `127.0.0.1:4096` remained
  OpenCode PID `30381`. The test used child-only ports `4990`/`4991`; neither
  aborting child reached a listening banner.
- GitNexus `detect_changes(scope=all, worktree=...)` reported low risk, zero
  changed symbols, and zero affected processes. Its diff scanner reported the
  two tracked docs; the new untracked test is separately visible in
  `git status --short`.

## 2026-08-20 final Bucket E repair

### Contract

- `docs/ai/contracts/issue-1396-1397-1394.json`
- WAIVED: this repair adds verification evidence and contract hygiene for
  already-implemented behavior and forbids product changes absent a proven
  defect; verification is the real Postgres built-server startup contract plus
  exact real-router client non-disclosure assertions.
- #1394-c2 now has explicit evidence for the required external Compose volume
  identity. #1394-c4 is `not_tested`, not pass, because its Postgres proof is
  blocked before server launch by a real bootstrap failure.

### Files

- Added `apps/api_server/src/__tests__/issue_1394_postgres_startup_diagnostic.test.ts`.
  It reuses the existing `postgres:16` + `runPostgresBootstrap` harness, creates
  a unique disposable schema, seeds one current artifact with absent bundle and
  state content, starts only built `dist/server.js` on API `4994`, engine `4995`,
  gateway `4996`, and asserts health plus the exact path-free startup diagnostic.
  Its `finally` stops the child, drops the schema, closes pools, and removes the
  temporary HOME/storage root.
- Strengthened `apps/api_server/src/__tests__/live_artifacts.test.ts` so both
  detail and render assert the exact client payload
  `{error:{code:"INTERNAL_ERROR",message:"Live artifact content unavailable"}}`
  and reject filesystem layout, `ENOENT`, stack, and storage-variable leakage.
- Product code was not changed.

### Checks

- `npm run build` — pass (`tsc -p tsconfig.json` and postbuild).
- `npx vitest run src/__tests__/live_artifacts.test.ts --no-file-parallelism`
  — pass, 27/27. The real Express/router detail and render responses match the
  exact generic error payload and expose no path or stack.
- Disposable Postgres attempt 1:
  `RHYTHM_LIVE_POSTGRES_DIAGNOSTIC=1 RHYTHM_LIVE_POSTGRES_URL=<throwaway> npx vitest run src/__tests__/issue_1394_postgres_startup_diagnostic.test.ts --no-file-parallelism --disableConsoleIntercept --reporter=verbose`
  — failed before child startup: `relation "agent_sessions" does not exist` at
  `runPostgresBootstrap` (`postgres_bootstrap.ts:1087`).
- Disposable Postgres attempt 2 with `RHYTHM_ROLE=all` — same failure.
- Existing harness confirmation:
  `AGENT_LOCAL=true RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1 RHYTHM_LIVE_POSTGRES_URL=<throwaway> npx vitest run src/__tests__/postgres_bootstrap_live.test.ts --no-file-parallelism`
  — failed identically on a fresh unique schema. This proves the blocker is the
  current bootstrap, not the new test harness.
- Contract JSON invariant — pass: every pass status has a nonempty reason and
  every `not_tested` criterion has a nonempty reason and matching list entry.
- `git diff --check` — pass. `git diff --name-only` contains only the owned route
  test and contract/run docs; `git status --short` additionally shows the owned
  untracked Postgres test.
- GitNexus `detect_changes(scope=all, worktree=...)` — low risk, zero indexed
  changed symbols/processes across three tracked files; the untracked Postgres
  test is separately accounted for by `git status`.

### Notes

- Existing Postgres convention used: cached `postgres:16` image, unique
  container name and host port `55494`, unique schema, and `runPostgresBootstrap`.
  Each shell command installed an EXIT/INT/TERM trap and removed its container;
  the test also owns schema/process/filesystem cleanup.
- Docker daemon `29.2.1` was healthy and the cached Postgres image was present.
- Protected listeners were observed before testing at API `4001` PID `30369`,
  engine `4096` PID `30381`, sandbox engine `4097` PID `90691`, and sandbox API
  `4098` PID `90638`; none was targeted. Final inspection preserved `4001` PID
  `30369` and `4096` PID `30381`; `4097`/`4098` had become free independently.
  The new contract reserved only `4994`/`4995`/`4996` after confirming those
  ports free, and final inspection found `4994`/`4995`/`4996`/`55494` free with
  no `rhythm-1394` containers left.
- Per dispatch, a real product defect stops this tests/docs-only repair. No
  attempt was made to change `postgres_bootstrap.ts` or bypass Postgres with
  SQLite. The remaining requested Bucket E focused 21/21 and startup-abort
  suites were not rerun after the stop condition.
