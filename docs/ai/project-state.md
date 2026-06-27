# Project State

## Current focus

**2026-06-26 — PR #749 smoke/merge readiness plus skill-gap mapping from recent runs.**

Recent work clusters around agent-session UX, opencode runtime scoping, and
workflow discipline. The strongest repeated gaps are:

- runtime-boundary verification against real dependencies and packaged builds
- production-environment parity (Postgres, packaged binary, long-lived backend)
- tighter subagent workflow boundaries and durable-edit discipline

## Active branch / PR

- **Branch:** `workflow/run-2026-06-25-agent-fixes`
- **PR:** [#749](https://github.com/ajhochy/Rhythm/pull/749) — draft on `feature/agent-scheduler`; implementation verified, smoke partly blocked by macOS screen-recording consent modal.
- **Related open PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — Odysseus port + mcp-scope stack on `main`; still needs live packaged-runtime validation.

## In progress

- Manual smoke / merge readiness for #749.
- Translating recent PR/postmortem patterns into a concrete skill progression map.

## Risks

- **Verification remains strongest in local test harnesses, weaker at real runtime seams.**
  Recent failures came from SDK shape drift, packaged binary path drift, stale
  backend processes, and Postgres bootstrap drift that green local suites missed.
- **Subagent process control is still leaky.**
  The #749 run recorded a coding subagent opening a PR and committing outside its
  bounds, plus an earlier non-durable edit to `~/.config/opencode/.../secretary.md`.
- **UI smoke still has environment blockers.**
  macOS consent modals can block automated click-through verification of agent UI flows.

## Test status

- `flutter analyze --no-fatal-infos` — PASS
- `dart format --set-exit-if-changed` — PASS
- `apps/api_server npx tsc --noEmit` — PASS
- `apps/api_server vitest` — PASS
- `flutter test` — PASS
- Manual smoke — partial; some #749 checks still blocked by local OS permissions

## Next step

1. Finish the blocked #749 smoke items on a machine/session with screen-recording permission settled.
2. Turn the identified gaps into follow-up workflow tightening, especially around verification and coding-agent boundaries.
3. Use `docs/ai/runs/2026-06-26-skill-progression-map.md` as the evidence base for skill-deepening priorities.
