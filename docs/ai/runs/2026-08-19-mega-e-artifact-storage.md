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
