---
date: 2026-06-25
repo: Rhythm
branch: workflow/run-2026-06-25-agent-fixes
pr: null
issues: [746]
status: implemented + verified (all checks pass); manual smoke pending
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Issue #746 — Agent session startup latency reduction

## Context

Issue #746 targeted the ~30s cold-start delay observed when opening a new agent session.
Four changes were required:

1. **Phase timing logs** — attribute latency to specific phases of engine init and session create.
2. **Eager engine warm** — already fire-and-forget at server start; wired `notifyEngineReady()` into the `.then()` callback.
3. **Non-blocking composer (main UX win)** — chat window must render immediately with a "Connecting…" state.
4. **Skill curator throttle** — `queueSkillExtraction` must defer during the first 90s after engine init.

Guard: do NOT regress mcp-scope work (per-session MCP allowlist shipped in issues 01–06 on `feature/agent-scheduler`).

## Files changed

- `apps/api_server/src/services/opencode_client_service.ts` — `_engineReadyAt` field + `engineReadyAt` getter + `[Opencode][timing]` phase logs for all 6 phases of `_initializeImpl()` + total elapsed
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — 3-phase timing logs in `create()` (ensureReady, createSession, streamSession) + total
- `apps/api_server/src/services/skill_extractor.ts` — `CURATOR_COLD_WINDOW_MS = 90_000`, `notifyEngineReady()` export, `isCuratorThrottled()`, early-return throttle in `queueSkillExtraction()`
- `apps/api_server/src/server.ts` — calls `notifyEngineReady(engineReadyAt ?? Date.now())` in `initialize().then()` block (non-fatal try/catch)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — `_EngineConnectingState` widget (banner + spinner + disabled composer); `_TranscriptPanelState.build()` shows it when `isCreating == true && selected == null`; `EngineConnectingStateTestHarness` @visibleForTesting
- `apps/api_server/src/__tests__/issue_746_latency.test.ts` (NEW) — 6 tests: curator throttle defers/resumes/skips-below-min-rounds, throttle log emitted, engineReadyAt null before init
- `apps/desktop_flutter/test/features/agents/issue_746_connecting_state_test.dart` (NEW) — 5 widget tests: banner text, spinner, disabled TextField, disabled Send, hint text

## Checks run

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS — exit 0 |
| `dart format --set-exit-if-changed` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings |
| `vitest run` (146 files) | PASS — 1250/1250 |
| `flutter test` | PASS — 693/693 |
| mcp-scope guard (diff review) | PASS — zero MCP connection/init changes |

## Notes

- `notifyEngineReady` wired from `server.ts` (not `opencode_client_service.ts`) to avoid circular import. Decision: `docs/ai/decisions/2026-06-25-issue-746-notifyengineready-wiring.md`.
- MCP lazy-init NOT attempted — timing logs will reveal if MCP init is a material cost in production; follow-up issue to be filed if `createOpencode` phase shows > 10s.
- Cold window 90s chosen to match observed worst-case cold-start + `restoreAuth` duration.
- Visual screenshot of `_EngineConnectingState` is a manual smoke item — widget is only visible during ~30s in-flight window; Flutter was not running during this session.

## Failure triage

Not triggered — all checks passed on first run.
