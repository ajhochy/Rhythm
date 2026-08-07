---
date: 2026-08-06
repo: Rhythm
branch: workflow/run-2026-08-06-ci-gates-and-plan-agent
pr: pending
issues: [1328, 1329]
status: verified — PR pending
tags: [run, Rhythm, ci, agents]
index: "[[Rhythm]]"
---

# CI gates that hid each other, and dropping the unused `plan` agent

Follow-up work after PR #1319 merged (`f1520c99`). Three fixes, all reported
immediately after the merge.

## Files changed

- `.github/workflows/desktop_ci.yml` — every gate reports independently.
- `.github/workflows/mobile_ci.yml` — `push` scoped to `main`; concurrency group
  keyed on the ref instead of the head SHA.
- `apps/api_server/src/services/opencode_agent_writer.ts` —
  `isSelectableEngineAgent()`; built-ins filtered out of the delegate roster.
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — filter applied
  at the listing boundary only.
- `apps/api_server/src/contract/plan_agent_not_selectable.test.ts` — new, 14 tests.
- `apps/api_server/src/__tests__/opc_m4_4_agent_selection.test.ts`,
  `opc_agent_session_routes.test.ts` — re-pinned to the new contract.

Commit: `126e866c`.

## Checks run

- `npm run build` (tsc) — exit 0.
- `npm test -- --fileParallelism=false` — exit 0, **480 files passed**, 85 skipped,
  0 failed.
- New contract suite — 14/14, both defects mutation-verified.
- Live: `GET /agent-sessions/agents` against the running backend — **43 → 37**
  agents, `plan` absent, `build` retained, in both raw and `view=picker` shapes.
- Both workflow YAMLs parse; step conditions inspected.

## Notes

### #1328 — the cheapest gate hid the most expensive one

A step's default condition is `success()`, which is false once ANY earlier step
failed. `dart format`, `flutter analyze`, `flutter test` and the build were plain
sequential steps, so they behaved as one fail-fast chain. An unformatted
`ws_send_queue_test.dart` failed `dart format`, `flutter test` never ran, and 64
test files that could not **compile** went unnoticed for two days — 413 tests
silently not executing while the local run still reported a healthy-looking
`+636`.

Each gate now carries `if: ${{ !cancelled() && steps.<dep>.outcome == 'success' }}`,
naming the step it genuinely depends on. Independent signals all report; a real
prerequisite failure still skips its dependents rather than emitting cascading
noise. `flutter analyze` alone would have caught the compile breakage — it reports
`invalid_override`.

### #1329 — Mobile CI cancelled itself

It triggered on `push` AND `pull_request`; for a branch push both events yield the
same `github.event.pull_request.head.sha || github.sha`, so `cancel-in-progress`
killed one of two runs for the same commit. Which one died was a race, observed
flipping across `558f7e04` (push lost) / `ee6ea444` / `8faea09f` (PR lost). When
the `pull_request` run lost, the PR showed a red check with a cancelled job and no
failing test — indistinguishable from a real failure, and previously dismissed as
cosmetic.

The original intent (one run per commit) was right; the mechanism was wrong. Fixed
at the source: `push` now only fires on `main`, so the duplicate never launches,
and the group keys on the ref so it supersedes only OLDER commits.

### `plan` was selectable; the delegation half was already safe

Measured live before the fix: `GET /agent-sessions/agents` returned 43 entries and
**all seven** engine built-ins were among them — `build`, `plan`, `explore`,
`general`, `compaction`, `summary`, `title` — in both the raw and picker shapes.
The engine does not set `builtIn` on them (it came back `undefined`), so they were
indistinguishable from Rhythm's own projected profiles.

Delegation, however, already blocked `plan` on all three primitives, and the tests
now pin that:

- `task` projects `{"*": "deny", explore: allow, general: allow}` — `plan` was
  never an allowed target (verified: 0 of the projected `.md` files allow it).
- `rhythm_delegate` and `rhythm_delegate_async` resolve the target through
  `requireExecutableProfile`, which needs an `agent_configs` row; `plan` has none
  because `BUILTIN_OPENCODE_AGENT_IDS` excludes it from the writer.

The one real hole: `buildTaskDelegatePermissions` spreads the delegate roster
**after** the natives, so a roster entry naming `plan` would have overridden the
wildcard deny. Built-ins are now filtered out of the roster. Checked the live DB
first — the two rows matching "plan" are `planning-agent` and `worship-planning`,
both legitimate profiles, and a test pins that they survive the filter.

### Two pre-existing tests asserted the OLD contract

`issue-703-c1` explicitly required `plan` to be in the agent list — that was how
#703 demonstrated built-ins surface at all. Both it and `opc_agent_session_routes`
were updated to pin the new behaviour and **strengthened** to assert `plan`'s
absence, rather than merely relaxing a length check. Worth remembering: a red
suite after an intentional contract change is the tests doing their job; the fix
is to re-pin intent, not to loosen assertions.

### Scope judgement: filter six built-ins, keep `build`

Only `plan` was reported, but `compaction`/`summary`/`title` are engine-internal
and `explore`/`general` are `task`-only subagents — same defect, same root cause,
so filtering just `plan` would have left five siblings leaking. `build` is kept
deliberately: it is the engine's default and Rhythm falls back to it for an
agent-less session (`agent_sessions_controller.ts`). The filter is fail-CLOSED, so
a built-in added by a future engine release stays hidden until allow-listed.

`refreshAgents` still reconciles against the UNFILTERED engine list — pinned by
test — so hiding an agent from the picker can never deactivate a profile.

### Observed, not ours: GitHub Actions instability

Across this session's pushes, `Set up job` failed five times with
`Failed to resolve action download info. Error: Service Unavailable`, before
checkout and before any repo code ran. Three other runs were cancelled while still
queued, at the same second, having never been assigned a runner. When judging a red
check today, confirm the job actually started.

### Gap

`apps/api_server`'s `npm run lint` is a stub (`echo 'TODO: add eslint'`) — there is
no real lint gate for that app. Not addressed here.
