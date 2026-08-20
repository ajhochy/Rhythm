---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-e-artifact-storage
pr: null
issues: [1396, 1397, 1394]
status: ready_for_verification
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
