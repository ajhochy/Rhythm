# Project State

## Current focus

Two branches merged to `main` this session:

1. opencode session-continuity fixes (#912 + #913) in the vendored fork
   (PR #924).
2. `issue-batch-july4` — agent profiles/sessions/scheduling UX + agent-infra
   (#894–#911) (PR #925).

Plus a full audit of the agent system (profiles, delegation, skill/MCP
scoping) that produced 10 follow-up issues (#914–#923), not yet fixed.

## Active branch / PR

- PR #924 (`issue-912-913-opencode-continuity`) — MERGED to `main`
  (Fixes #912, #913).
- PR #925 (`issue-batch-july4`, 22 commits) — MERGED to `main`.
- PR #901 (`feature/config-doctor-agent`) — merged last session.

## In progress

- Nothing mid-flight. #912/#913 and the July-4 batch are on `main`.
- Agent-system audit fixes (#914–#923) NOT started — filed as issues only,
  per user instruction to leave them for later.

## Risks / known issues

- Both #912/#913 fixes live in the vendored `apps/opencode_fork` — keep diffs
  minimal/tagged so they survive upstream merges. Test against the BUILT fork
  binary (set `RHYTHM_OPENCODE_BIN`), never the stock PATH binary.
- `#913 repairToolPairing` is a defensive repair at the request chokepoint —
  the true producer of the dangling `tool_use` was never located.
- `#913 autoContinueExhausted` resets on any completed tool call (coarse by
  design) — the cap is a backstop, not a guarantee.
- Audit HIGH findings still open: delegation caller-identity spoofing (#914),
  60s delegation timeout causing duplicate runs (#915), scope fail-open /
  config-doctor full surface (#916), nonexistent tool/server names in
  allowlists (#917). Medium/low: #918–#923.

## Test status

- #924 (opencode continuity): api_server `tsc` clean + `npm test` 2405 passed;
  fork targeted suites 330 pass; fork binary builds; live-engine smoke on the
  built fixed binary passed. CI green; merged.
- #925 (July-4 batch): api_server `tsc` clean + `npm test` 2435 passed;
  flutter 846 tests, analyze at the 272-info baseline, `dart format` clean.

## Next step

- Manual smoke on `main` for the opencode continuity fixes (long Codex/gpt
  session; long compacting session) and the batch UX changes.
- When ready, tackle the agent-system audit issues #914–#923 (start with the
  HIGH ones) on a dedicated branch with a durable data-repair migration.

## Recent coding-agent runs

### 2026-07-06 — issue-batch-917-918-919-921
- Files modified: `apps/api_server/src/database/migrations.ts` (profile data repair), `apps/api_server/src/services/agent_runner.ts` (fallback model), `apps/api_server/src/services/opencode_agent_writer.ts` (disabled projection gate), focused API tests, `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (trigger profile routing), docs run log.
- Checks run: `npx tsc --noEmit` pass; targeted Vitest pass (`6 files, 50 tests`); full `npm test` failed under sandbox bind restrictions (`listen EPERM`, `1971 passed / 423 failed / 58 skipped`); Flutter `dart format .` and `flutter analyze --no-fatal-infos` blocked by SDK cache write permission.
- Decisions made: #921 uses trigger-only routing to `secretary` instead of globally scoping `claude-code`/`codex`, preserving manual escape-hatch behavior.
- Deviations from spec: full Vitest and Flutter checks could not complete cleanly in this sandbox; local stale opencode agent files could not be removed from `~/.config`.
- Concerns: orchestrator should rerun full API/Flutter checks in an environment allowed to bind ports and write the Flutter SDK cache.
