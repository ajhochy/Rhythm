# Project State

## Current focus

**Unified Session Observability epic (#1034) + #1002 AgentRunner fix
(2026-07-11)** — every LLM call now observable in one filtered session list,
and the P1 headless-AgentRunner bug is fixed. 13 issues delivered across 6
parallel worktree workstreams, integrated + live-verified.
See `docs/ai/runs/2026-07-11-uso-epic-1002-live-e2e.md` and
`docs/ai/decisions/2026-07-11-1002-fix-lost-on-main.md`.

## Active branch / PR

- **`workflow/uso-epic-2026-07-11`** — opening PR closing #1002, #1023-#1034.
  Verified (tsc + 2683 vitest + Flutter 858 + live e2e). Awaiting CI + manual
  UI smoke. Do NOT merge without smoke.
- **Stale PR #1005** — superseded (its #1002 fix is re-landed on this branch);
  can be closed.

## In progress

- Manual UI smoke handoff for the Flutter Phase A surface (category dropdown /
  status sort / retired Session History / reused transcript detail) and the two
  deferred live loops (B4 measure re-run, B5 skill-extract).

## Risks / known issues

1. **#1023 release-build acceptance is deferred to a real workflow_dispatch**
   - bundled-node presence, notarization, ABI-equality on the runner, and
   real-machine start are only provable by an actual signed release build.
2. **B4/B5 not directly live-run** - unit-verified; their run() path was
   exercised live via B2/B3. Smoke: approve a measure-routed proposal; drive a
   2-round skill-extract.
3. Phase B run() adds skill/memory prefaces (input-only, parsers unaffected)
   and can teacher-escalate on error - could make a failing measure re-run read
   slightly cleaner (lenient KEEP); human revert (#857) backstops.
4. Full-suite has 2 order-dependent flaky tests (AgentProfileSync engine-not-
   ready timing) - green on clean re-run; pre-existing, not from this change.
5. Org-optimizer cron stays OFF pending safety review (unchanged).

## Test status

- api_server `tsc --noEmit` clean; full `vitest run` 2683 passed / 0 failed.
- Flutter `dart format` clean; `flutter analyze --no-fatal-infos` 0 errors/0
  warnings; `flutter test` 858 passed.
- Live e2e (standalone :4011, isolated DB copy): 3 scopes correct, #1002
  headless output confirmed (0 no-output errors), self_improvement transcripts
  present, B6 audit clean.

## Next step

1. Open the PR (Closes lines for #1002 + #1023-#1034) and watch CI to green.
2. Hand off manual UI smoke (checklist in the run log).
3. After smoke passes, merge; then trigger a release build to prove #1023.

## Recent coding-agent runs

### 2026-07-11 — #1039 scheduled/background profile-run fix (branch uso/agent-invocation-fix, stacked on epic)
- Files modified:
  - `services/opencode_agent_writer.ts` — session-selectable profiles now
    written `mode: all` (was `primary`) so a promoted profile is BOTH
    top-level-runnable AND still a delegation target. Fork mode enum is
    `["subagent","primary","all"]` (agent/agent.ts:31) — `all` is supported.
  - `controllers/agentSchedulesController.ts` — `assertSchedulableProfile()`
    guard on create + re-bind update: rejects binding a scheduled task to a
    non-session-selectable (delegation-only/subagent) profile with a 400 and an
    actionable message. CLI kinds / built-ins (no config row) pass through.
  - `services/agent_runner.ts` — Cause B: when running AS the profile's own
    registered agent (`ocAgent === effectiveConfigId`, backfilled by #858) and
    NOT an mcpRole run, OMIT the per-message `system:` override. The `.md` body
    already IS the profile prompt (writer writes body=systemPrompt) and opencode
    layers `user.system` AFTER the agent prompt (session/llm.ts) → it was
    duplicated. self_improvement/mcpRole path unchanged (still forwards system).
  - `repositories/agent_sessions_repository.ts` + `services/agentSchedulerService.ts`
    — Cause C: `reapStuckSessions(maxAgeMs)` called each scheduler tick
    (cutoff = 2× AGENT_RUN_TIMEOUT_MS, min 20 min) recovers post-boot orphans
    stuck in starting/running without a restart.
  - Tests: `__tests__/agent_schedules_delegation_guard.test.ts` (new, 4 cases),
    `__tests__/p2_systemprompt_ocagent.test.ts` (+2 cases).
- Checks run: `tsc --noEmit` clean; `vitest run` 2689 passed / 0 failed / 26
  skipped (baseline 2683 + 6 new).
- Decisions made: run-as-own-`.md`-agent = single source of scoping (owner
  direction); `mode: all` over `primary`; mcpRole is the discriminator that
  keeps self_improvement on the assembled-scope path. See
  `docs/ai/decisions/2026-07-11-1039-run-as-own-agent-single-source.md`.
- Deviations from spec: Cause B empty-output for AI-Trend-Researcher is NOT
  fully confirmed by code reading — the deeper factor is opencode `session/llm.ts:122`
  (`input.agent.prompt` REPLACES the provider agentic prompt) combined with that
  profile's restrictive `.md` (`permission: read/glob/grep: deny`, `tools:(none)`).
  Dropping the duplicate `system:` is the sanctioned direction and removes a real
  redundancy, but whether it alone restores non-empty output needs the live trace
  the orchestrator will run. See Concerns.
- Concerns: (1) Live re-trigger of theological + AI-trend scans still required to
  confirm real output (orchestrator owns :4096). Exact experiment: with the app
  on this branch, `POST /agent-schedules/:id/trigger-now` for each; if AI-Trend
  is still empty after the system-override drop, the cause is the .md permission
  denies / provider-prompt replacement (loosen the profile `.md` or stop passing
  `agent:` for tool-less research personas). (2) Pre-existing scheduled tasks
  bound to a now-subagent profile still error at run time until re-bound — guard
  is create/update-time only, by design.
