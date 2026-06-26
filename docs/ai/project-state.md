# Project State

## Current focus

**2026-06-25 — Agent-subsystem UX/observability fixes (6 issues).**

Branch `workflow/run-2026-06-25-agent-fixes` (off `feature/agent-scheduler`)
resolves six agent/opencode issues. All implemented, all checks green:

- **#745** — new sessions default to the manager profile (Secretary), not `build`.
- **#742** — reliable Secretary→`@workflow-orchestrator` routing + 3-level delegation.
- **#743** — delegated subagent (child `task`) sessions persisted + nested; `/diff` 404 flood stopped.
- **#747** — top-bar background-activity indicator + system sessions excluded from the list.
- **#746** — non-blocking composer / "connecting" state, engine phase timing logs, curator throttle.
- **#748** — managed headless Chrome on `:9222` for agent browser smoke.

## Active branch / PR

- **Branch:** `workflow/run-2026-06-25-agent-fixes`
- **PR:** [#749](https://github.com/ajhochy/Rhythm/pull/749) — draft, base `feature/agent-scheduler`, `Closes` all 6 issues. Do not auto-merge.
- **Related open PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — mcp-scope work into `main`, do not merge.

## In progress

Implementation + verification complete; awaiting manual smoke + human merge of #749.

Durable design notes worth carrying forward:
- #742 routing is delivered by a version-controlled `MANAGER_ROUTING_PREAMBLE`
  injected in `opencode_agent_writer.ts` for manager profiles (NOT a hand-edit of
  the home-dir `secretary.md`, which is runtime output and non-durable). It is
  projected to the live `secretary.md` on the next Secretary-profile save/re-sync.
- #743 added `parent_session_id` (self-FK) and #747 added `is_system` to
  `agent_sessions`, with idempotent migrations in BOTH `migrations.ts` (SQLite)
  and `postgres_bootstrap.ts` (Postgres).

## Risks / known issues

- **Live visual + server smoke pending** — #745 picker, #746 connecting banner, and
  #747 header indicator need confirmation under `flutter run -d macos` with the
  local engine (`:4001`/`:4096`); behavioral contracts are covered by widget tests.
- **#742 provider parity is prompt-level** — the engine `task` tool already requires
  an explicit `subagent_type`; Gemini→`@general` is the model omitting it. The
  preamble is the lever; no safe engine-side default exists. Residual model variance possible.
- **#746 CHROME/MCP env→engine timing** — `CHROME_CDP_*` is set on `process.env`; the
  deterministic fix is Chrome actually running on `:9222`. Env propagation to the
  engine subprocess is best-effort (spawn-time race), not relied upon.
- **#746 lazy per-session MCP init deferred** — judged too entangled with the
  just-shipped mcp-scope work to change safely; timing logs will quantify the cost.
  Candidate follow-up if `createOpencode` dominates the ~30s.
- **Pre-existing flaky test** (`claude_triggers` / `tasks_controller` order isolation) — unrelated to this branch.
- **mcp-scope live smoke still required** — CI fork-binary bundle not yet exercised in a real release run (PR #734).

## Test status

| Suite | Status |
|-------|--------|
| `dart format --set-exit-if-changed` | **PASS** — 0 changed |
| `flutter analyze --no-fatal-infos` | **PASS** — 0 errors/warnings |
| `flutter test` | **PASS** — 693/693 |
| `apps/api_server npx tsc --noEmit` | **PASS** — exit 0 |
| `apps/api_server vitest` | **PASS** — 1273/1273 |
| `apps/opencode_fork` bun suite | **N/A** — zero fork files changed this run |

## Next step

1. Manual smoke of PR #749 under `flutter run -d macos` (see `docs/ai/runs/2026-06-25-agent-fixes-run.md` checklist).
2. After smoke passes, human merge of #749 into `feature/agent-scheduler` (no auto-merge).
3. Consider follow-up issues for: lazy per-session MCP init (#746), `smoketest-runner.mjs` self-launch robustness (#748).

Run logs: `docs/ai/runs/2026-06-25-agent-fixes-run.md` (consolidated) +
per-issue logs `2026-06-25-agent-fixes-745-742.md`,
`2026-06-25-issue-743-child-session-persistence.md`,
`2026-06-25-issue-746-startup-latency.md`.
Decisions: `docs/ai/decisions/2026-06-25-delegation-depth.md`,
`2026-06-25-issue-743-logger-debug.md`,
`2026-06-25-issue-746-notifyengineready-wiring.md`,
`2026-06-25-issue-747-is-system-column.md`.
